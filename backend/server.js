
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const SLOTS = [
    'morning',
    'after_breakfast',
    'after_lunch',
    'after_dinner'
];

const corsOptions = {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is missing from .env');
    process.exit(1);
}

// Indian local date helper
function indiaDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const values = {};
    parts.forEach(part => {
        values[part.type] = part.value;
    });

    return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateString(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
        return false;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
}

// Convert incoming datetime to UTC.
// datetime-local values are interpreted as Indian local time.
function parseReadingTime(value) {
    if (!value) {
        return new Date();
    }

    if (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)
    ) {
        return new Date(`${value}+05:30`);
    }

    return new Date(value);
}

// PostgreSQL stores measured_at as timestamp without time zone.
// Store UTC values without the trailing Z.
function toDatabaseTimestamp(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

// Detect database timestamp type and convert to Indian local time.
let localDateExpressionPromise;

async function getLocalDateExpression() {
    if (!localDateExpressionPromise) {
        localDateExpressionPromise = pool.query(
            `SELECT data_type
             FROM information_schema.columns
             WHERE table_schema = current_schema()
             AND table_name = 'glucose_readings'
             AND column_name = 'measured_at'`
        ).then(result => {
            if (result.rows.length === 0) {
                throw new Error('measured_at column not found');
            }

            const type = result.rows[0].data_type;

            if (type === 'timestamp with time zone') {
                return "(measured_at AT TIME ZONE 'Asia/Kolkata')";
            }

            if (type === 'timestamp without time zone') {
                return "(measured_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')";
            }

            throw new Error('Unsupported measured_at column type: ' + type);
        }).catch(error => {
            localDateExpressionPromise = null;
            throw error;
        });
    }

    return localDateExpressionPromise;
}

// Validate reading input
function validateReadingInput(glucoseLevel, slot, measuredAt) {
    if (
        glucoseLevel === undefined ||
        glucoseLevel === null ||
        glucoseLevel === '' ||
        !Number.isInteger(Number(glucoseLevel)) ||
        Number(glucoseLevel) < 40 ||
        Number(glucoseLevel) > 600
    ) {
        return 'Glucose level must be a whole number between 40 and 600';
    }

    if (!SLOTS.includes(slot)) {
        return 'Please select a valid reading slot';
    }

    if (Number.isNaN(measuredAt.getTime())) {
        return 'Please enter a valid measurement date and time';
    }

    if (measuredAt.getTime() > Date.now()) {
        return 'Future measurement dates are not allowed';
    }

    return null;
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Access denied. Please login.'
        });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_SECRET, (error, user) => {
        if (error) {
            return res.status(403).json({
                message: 'Invalid or expired token'
            });
        }

        req.user = user;
        next();
    });
}

// HOME
app.get('/', (req, res) => {
    res.send('Sweety Blood Glucose Tracker API is running!');
});

// DATABASE TEST
app.get('/db-test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS now');

        res.json({
            message: 'PostgreSQL connected successfully!',
            time: result.rows[0].now
        });
    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({
            message: 'Database connection failed'
        });
    }
});

// REGISTER
app.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: 'Name, email and password are required'
            });
        }

        if (
            typeof name !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string'
        ) {
            return res.status(400).json({
                message: 'All fields must be text'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                message: 'Password must contain at least 6 characters'
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanName || !cleanEmail) {
            return res.status(400).json({
                message: 'Name and email cannot be empty'
            });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, name, email`,
            [cleanName, cleanEmail, passwordHash]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(201).json({
            message: 'Registration successful',
            user,
            token
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.code === '23505') {
            return res.status(409).json({
                message: 'Email is already registered'
            });
        }

        res.status(500).json({
            message: 'Registration failed'
        });
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [cleanEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            message: 'Login failed'
        });
    }
});

// PROTECTED TEST
app.get('/protected', authenticateToken, (req, res) => {
    res.json({
        message: 'You have accessed a protected route',
        user: req.user
    });
});

// ADD READING
app.post('/readings', authenticateToken, async (req, res) => {
    const { glucose_level, slot, measured_at } = req.body;
    const readingTime = parseReadingTime(measured_at);

    const validationError = validateReadingInput(
        glucose_level,
        slot,
        readingTime
    );

    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    let client;

    try {
        const localDateExpression = await getLocalDateExpression();
        const date = indiaDateString(readingTime);

        client = await pool.connect();
        await client.query('BEGIN');

        // Prevent simultaneous requests exceeding daily limits.
        await client.query(
            'SELECT id FROM users WHERE id = $1 FOR UPDATE',
            [req.user.id]
        );

        const duplicate = await client.query(
            `SELECT id FROM glucose_readings
             WHERE user_id = $1
             AND slot = $2
             AND (${localDateExpression})::date = $3::date`,
            [req.user.id, slot, date]
        );

        if (duplicate.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: 'A reading already exists for this slot on this day'
            });
        }

        const countResult = await client.query(
            `SELECT COUNT(*) AS total
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date = $2::date`,
            [req.user.id, date]
        );

        if (Number(countResult.rows[0].total) >= 4) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'You can add a maximum of 4 readings per day'
            });
        }

        const result = await client.query(
            `INSERT INTO glucose_readings
             (user_id, glucose_level, measured_at, slot)
             VALUES ($1, $2, $3, $4)
             RETURNING id, user_id, glucose_level, measured_at, slot`,
            [
                req.user.id,
                Number(glucose_level),
                toDatabaseTimestamp(readingTime),
                slot
            ]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Glucose reading saved successfully',
            reading: result.rows[0]
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }

        console.error('Add reading error:', error);

        res.status(500).json({
            message: 'Could not save glucose reading'
        });

    } finally {
        if (client) client.release();
    }
});

// GET ALL READINGS
app.get('/readings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, glucose_level, measured_at, created_at, slot
             FROM glucose_readings
             WHERE user_id = $1
             ORDER BY measured_at DESC`,
            [req.user.id]
        );

        res.json({
            message: 'Readings retrieved successfully',
            total: result.rows.length,
            readings: result.rows
        });

    } catch (error) {
        console.error('Get readings error:', error);
        res.status(500).json({
            message: 'Could not retrieve readings'
        });
    }
});

// EDIT READING
app.put('/readings/:id', authenticateToken, async (req, res) => {
    const readingId = Number(req.params.id);
    const { glucose_level, slot, measured_at } = req.body;

    if (!Number.isInteger(readingId) || readingId <= 0) {
        return res.status(400).json({
            message: 'Invalid reading ID'
        });
    }

    const readingTime = parseReadingTime(measured_at);

    const validationError = validateReadingInput(
        glucose_level,
        slot,
        readingTime
    );

    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    let client;

    try {
        const localDateExpression = await getLocalDateExpression();

        client = await pool.connect();
        await client.query('BEGIN');

        await client.query(
            'SELECT id FROM users WHERE id = $1 FOR UPDATE',
            [req.user.id]
        );

        const existing = await client.query(
            `SELECT id FROM glucose_readings
             WHERE id = $1 AND user_id = $2`,
            [readingId, req.user.id]
        );

        if (existing.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                message: 'Reading not found'
            });
        }

        const date = indiaDateString(readingTime);

        const duplicate = await client.query(
            `SELECT id FROM glucose_readings
             WHERE user_id = $1
             AND slot = $2
             AND id <> $3
             AND (${localDateExpression})::date = $4::date`,
            [req.user.id, slot, readingId, date]
        );

        if (duplicate.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: 'Another reading already exists for this slot on this day'
            });
        }

        const countResult = await client.query(
            `SELECT COUNT(*) AS total
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date = $2::date
             AND id <> $3`,
            [req.user.id, date, readingId]
        );

        if (Number(countResult.rows[0].total) >= 4) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'You can add a maximum of 4 readings per day'
            });
        }

        const result = await client.query(
            `UPDATE glucose_readings
             SET glucose_level = $1,
                 measured_at = $2,
                 slot = $3
             WHERE id = $4 AND user_id = $5
             RETURNING id, user_id, glucose_level, measured_at, slot`,
            [
                Number(glucose_level),
                toDatabaseTimestamp(readingTime),
                slot,
                readingId,
                req.user.id
            ]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Reading updated successfully',
            reading: result.rows[0]
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK').catch(() => {});
        }

        console.error('Edit reading error:', error);
        res.status(500).json({
            message: 'Could not update reading'
        });

    } finally {
        if (client) client.release();
    }
});

// DELETE READING
app.delete('/readings/:id', authenticateToken, async (req, res) => {
    const readingId = Number(req.params.id);

    if (!Number.isInteger(readingId) || readingId <= 0) {
        return res.status(400).json({
            message: 'Invalid reading ID'
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM glucose_readings
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [readingId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Reading not found'
            });
        }

        res.json({
            message: 'Reading deleted successfully',
            id: result.rows[0].id
        });

    } catch (error) {
        console.error('Delete reading error:', error);
        res.status(500).json({
            message: 'Could not delete reading'
        });
    }
});

// DAILY REPORT
app.get('/reports/daily', authenticateToken, async (req, res) => {
    try {
        const date = req.query.date;

        if (!isValidDateString(date)) {
            return res.status(400).json({
                message: 'Please provide a valid date in YYYY-MM-DD format'
            });
        }

        const localDateExpression = await getLocalDateExpression();

        const summary = await pool.query(
            `SELECT
                COUNT(*) AS total_readings,
                ROUND(AVG(glucose_level), 1) AS average_glucose,
                MAX(glucose_level) AS highest_glucose,
                MIN(glucose_level) AS lowest_glucose
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date = $2::date`,
            [req.user.id, date]
        );

        const readings = await pool.query(
            `SELECT id, glucose_level, measured_at, slot
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date = $2::date
             ORDER BY measured_at`,
            [req.user.id, date]
        );

        res.json({
            message: 'Daily report generated successfully',
            date,
            report: summary.rows[0],
            readings: readings.rows
        });

    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({
            message: 'Could not generate daily report'
        });
    }
});

// Shared report function for date ranges
async function generateRangeReport(userId, startDate, endDate) {
    const localDateExpression = await getLocalDateExpression();

    const summary = await pool.query(
        `SELECT
            COUNT(*) AS total_readings,
            ROUND(AVG(glucose_level), 1) AS average_glucose,
            MAX(glucose_level) AS highest_glucose,
            MIN(glucose_level) AS lowest_glucose
         FROM glucose_readings
         WHERE user_id = $1
         AND (${localDateExpression})::date >= $2::date
         AND (${localDateExpression})::date <= $3::date`,
        [userId, startDate, endDate]
    );

    const breakdown = await pool.query(
        `SELECT
            TO_CHAR((${localDateExpression})::date, 'YYYY-MM-DD') AS date,
            COUNT(*) AS total_readings,
            ROUND(AVG(glucose_level), 1) AS average_glucose,
            MAX(glucose_level) AS highest_glucose,
            MIN(glucose_level) AS lowest_glucose
         FROM glucose_readings
         WHERE user_id = $1
         AND (${localDateExpression})::date >= $2::date
         AND (${localDateExpression})::date <= $3::date
         GROUP BY (${localDateExpression})::date
         ORDER BY (${localDateExpression})::date`,
        [userId, startDate, endDate]
    );

    return {
        report: summary.rows[0],
        daily_breakdown: breakdown.rows
    };
}

// MONTHLY REPORT - entire selected month
app.get('/reports/monthly', authenticateToken, async (req, res) => {
    try {
        const year = Number(req.query.year);
        const month = Number(req.query.month);

        if (
            !Number.isInteger(year) ||
            year < 2000 ||
            year > 2100 ||
            !Number.isInteger(month) ||
            month < 1 ||
            month > 12
        ) {
            return res.status(400).json({
                message: 'Please provide a valid year and month'
            });
        }

        const startDate =
            `${year}-${String(month).padStart(2, '0')}-01`;

        const nextMonth = new Date(Date.UTC(year, month, 1));
        const endDate = new Date(nextMonth.getTime() - 86400000)
            .toISOString().slice(0, 10);

        const data = await generateRangeReport(
            req.user.id,
            startDate,
            endDate
        );

        res.json({
            message: 'Monthly report generated successfully',
            year,
            month,
            ...data
        });

    } catch (error) {
        console.error('Monthly report error:', error);
        res.status(500).json({
            message: 'Could not generate monthly report'
        });
    }
});

// MONTH-TO-DATE REPORT
app.get('/reports/month-to-date', authenticateToken, async (req, res) => {
    try {
        const date = req.query.date || indiaDateString();

        if (!isValidDateString(date)) {
            return res.status(400).json({
                message: 'Please provide a valid date in YYYY-MM-DD format'
            });
        }

        const startDate = `${date.slice(0, 7)}-01`;

        const data = await generateRangeReport(
            req.user.id,
            startDate,
            date
        );

        res.json({
            message: 'Month-to-date report generated successfully',
            start_date: startDate,
            end_date: date,
            ...data
        });

    } catch (error) {
        console.error('Month-to-date report error:', error);
        res.status(500).json({
            message: 'Could not generate month-to-date report'
        });
    }
});

// PREVIOUS MONTH REPORT
app.get('/reports/previous-month', authenticateToken, async (req, res) => {
    try {
        const today = indiaDateString();
        const currentMonthStart = `${today.slice(0, 7)}-01`;

        const previousMonthEnd = new Date(
            `${currentMonthStart}T00:00:00Z`
        );
        previousMonthEnd.setUTCDate(
            previousMonthEnd.getUTCDate() - 1
        );

        const endDate = previousMonthEnd.toISOString().slice(0, 10);
        const startDate = `${endDate.slice(0, 7)}-01`;

        const data = await generateRangeReport(
            req.user.id,
            startDate,
            endDate
        );

        res.json({
            message: 'Previous month report generated successfully',
            start_date: startDate,
            end_date: endDate,
            ...data
        });

    } catch (error) {
        console.error('Previous month report error:', error);
        res.status(500).json({
            message: 'Could not generate previous month report'
        });
    }
});

// UNKNOWN ROUTES
app.use((req, res) => {
    res.status(404).json({
        message: 'Route not found'
    });
});

// ERROR HANDLER
app.use((error, req, res, next) => {
    console.error('Unexpected server error:', error);
    res.status(500).json({
        message: 'Internal server error'
    });
});

// START SERVER
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
