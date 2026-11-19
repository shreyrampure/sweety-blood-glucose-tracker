
require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./db');

async function seedDatabase() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const name = 'Demo User';
        const email = 'demo@sweety.com';
        const password = 'Demo@123';

        const passwordHash = await bcrypt.hash(password, 10);

        // Find or create the demo user
        let userResult = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );

        let userId;

        if (userResult.rows.length > 0) {
            userId = userResult.rows[0].id;
        } else {
            userResult = await client.query(
                `INSERT INTO users (name, email, password_hash)
                 VALUES ($1, $2, $3)
                 RETURNING id`,
                [name, email, passwordHash]
            );

            userId = userResult.rows[0].id;
        }

        // Add four sample readings only if the demo user has none
        const existingReadings = await client.query(
            'SELECT COUNT(*) FROM glucose_readings WHERE user_id = $1',
            [userId]
        );

        if (Number(existingReadings.rows[0].count) === 0) {
            const readings = [120, 125, 135, 130];

            for (let i = 0; i < readings.length; i++) {
                await client.query(
                    `INSERT INTO glucose_readings
                     (user_id, glucose_level, measured_at)
                     VALUES ($1, $2, CURRENT_DATE + $3::time)`,
                    [userId, readings[i], ['07:00', '10:00', '13:00', '20:00'][i]]
                );
            }
        }

        await client.query('COMMIT');

        console.log('Seed completed successfully!');
        console.log('Demo email:', email);
        console.log('Demo password:', password);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Seed failed:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seedDatabase();
