
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const corsOptions = {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

// Check JWT secret
if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is missing from .env');
    process.exit(1);
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

// AUTHENTICATION MIDDLEWARE
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

        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [cleanEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                message: 'Email is already registered'
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

        if (!email || !password) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        if (
            typeof email !== 'string' ||
            typeof password !== 'string'
        ) {
            return res.status(400).json({
                message: 'Email and password must be text'
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

// PROTECTED TEST ROUTE
app.get('/protected', authenticateToken, (req, res) => {
    res.json({
        message: 'You have accessed a protected route',
        user: req.user
    });
});

// ADD GLUCOSE READING
app.post('/readings', authenticateToken, async (req, res) => {
    const { glucose_level, measured_at } = req.body;
    const level = Number(glucose_level);

    if (
        glucose_level === undefined ||
        glucose_level === null ||
        glucose_level === '' ||
        !Number.isFinite(level) ||
        level <= 0
    ) {
        return res.status(400).json({
            message: 'Please enter a valid glucose level greater than 0'
        });
    }

    let client;

    try {
        const readingTime = measured_at
            ? new Date(measured_at)
            : new Date();

        if (Number.isNaN(readingTime.getTime())) {
            return res.status(400).json({
                message: 'Please enter a valid measurement date and time'
            });
        }

        const localDateExpression = await getLocalDateExpression();

        client = await pool.connect();
        await client.query('BEGIN');

        // Lock the user row to prevent simultaneous extra readings.
        await client.query(
            'SELECT id FROM users WHERE id = $1 FOR UPDATE',
            [req.user.id]
        );

        const countResult = await client.query(
            `SELECT COUNT(*) AS total
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date =
                 ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date`,
            [req.user.id, readingTime.toISOString()]
        );

        const totalReadings = Number(countResult.rows[0].total);

        if (totalReadings >= 4) {
            await client.query('ROLLBACK');

            return res.status(400).json({
                message: 'You can add a maximum of 4 readings per day'
            });
        }

        const result = await client.query(
            `INSERT INTO glucose_readings
             (user_id, glucose_level, measured_at)
             VALUES ($1, $2, $3)
             RETURNING id, user_id, glucose_level, measured_at`,
            [req.user.id, level, readingTime.toISOString()]
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
        if (client) {
            client.release();
        }
    }
});

// GET ALL READINGS
app.get('/readings', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, glucose_level, measured_at, created_at
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

// DAILY REPORT
app.get('/reports/daily', authenticateToken, async (req, res) => {
    try {
        const date = req.query.date;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                message: 'Please provide a date in YYYY-MM-DD format'
            });
        }

        const localDateExpression = await getLocalDateExpression();

        const result = await pool.query(
            `SELECT
                COUNT(*) AS total_readings,
                ROUND(AVG(glucose_level), 2) AS average_glucose,
                MAX(glucose_level) AS highest_glucose,
                MIN(glucose_level) AS lowest_glucose
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date = $2::date`,
            [req.user.id, date]
        );

        res.json({
            message: 'Daily report generated successfully',
            date,
            report: result.rows[0]
        });

    } catch (error) {
        console.error('Daily report error:', error);

        res.status(500).json({
            message: 'Could not generate daily report'
        });
    }
});

// MONTHLY REPORT
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

        const localDateExpression = await getLocalDateExpression();

        // Monthly summary
        const summary = await pool.query(
            `SELECT
                COUNT(*) AS total_readings,
                ROUND(AVG(glucose_level), 2) AS average_glucose,
                MAX(glucose_level) AS highest_glucose,
                MIN(glucose_level) AS lowest_glucose
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date >= make_date($2, $3, 1)
             AND (${localDateExpression})::date <
                 (make_date($2, $3, 1) + INTERVAL '1 month')`,
            [req.user.id, year, month]
        );

        // Daily breakdown
        const breakdown = await pool.query(
            `SELECT
                TO_CHAR(
                    (${localDateExpression})::date,
                    'YYYY-MM-DD'
                ) AS date,
                COUNT(*) AS total_readings,
                ROUND(AVG(glucose_level), 2) AS average_glucose,
                MAX(glucose_level) AS highest_glucose,
                MIN(glucose_level) AS lowest_glucose
             FROM glucose_readings
             WHERE user_id = $1
             AND (${localDateExpression})::date >= make_date($2, $3, 1)
             AND (${localDateExpression})::date <
                 (make_date($2, $3, 1) + INTERVAL '1 month')
             GROUP BY (${localDateExpression})::date
             ORDER BY (${localDateExpression})::date`,
            [req.user.id, year, month]
        );

        res.json({
            message: 'Monthly report generated successfully',
            year,
            month,
            report: summary.rows[0],
            daily_breakdown: breakdown.rows
        });

    } catch (error) {
        console.error('Monthly report error:', error);

        res.status(500).json({
            message: 'Could not generate monthly report'
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
