
import { useEffect, useState } from 'react';
import './App.css';

const API = 'http://localhost:5000';

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonth() {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1)
  };
}

function App() {
  const [token, setToken] = useState(
    localStorage.getItem('sweetyToken') || ''
  );

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sweetyUser')) || null;
    } catch {
      return null;
    }
  });

  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [glucose, setGlucose] = useState('');
  const [measuredAt, setMeasuredAt] = useState('');
  const [readings, setReadings] = useState([]);

  const [dailyDate, setDailyDate] = useState(getToday());
  const [dailyReport, setDailyReport] = useState(null);

  const [month, setMonth] = useState(getCurrentMonth());
  const [monthlyReport, setMonthlyReport] = useState(null);

  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function apiRequest(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || 'Something went wrong');
    }

    return data;
  }

  async function handleAuth(event) {
    event.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const endpoint = mode === 'register' ? '/register' : '/login';

      const body = mode === 'register'
        ? { name, email, password }
        : { email, password };

      const data = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await data.json();

      if (!data.ok) {
        throw new Error(result.message || 'Authentication failed');
      }

      localStorage.setItem('sweetyToken', result.token);
      localStorage.setItem('sweetyUser', JSON.stringify(result.user));

      setToken(result.token);
      setUser(result.user);
      setPassword('');
      setMessage('Welcome to Sweety!');

    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('sweetyToken');
    localStorage.removeItem('sweetyUser');
    setToken('');
    setUser(null);
    setReadings([]);
    setDailyReport(null);
    setMonthlyReport(null);
    setMessage('');
    setMode('login');
  }

  async function loadReadings() {
    try {
      const data = await apiRequest('/readings');
      setReadings(data.readings || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function addReading(event) {
    event.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const body = {
        glucose_level: Number(glucose),
        ...(measuredAt
          ? { measured_at: new Date(measuredAt).toISOString() }
          : {})
      };

      const data = await apiRequest('/readings', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      setMessage(data.message || 'Reading saved successfully');
      setGlucose('');
      setMeasuredAt('');
      await loadReadings();

    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function getDailyReport(event) {
    if (event) event.preventDefault();
    setMessage('');

    try {
      const data = await apiRequest(
        `/reports/daily?date=${encodeURIComponent(dailyDate)}`
      );
      setDailyReport(data);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function getMonthlyReport(event) {
    if (event) event.preventDefault();
    setMessage('');

    try {
      const data = await apiRequest(
        `/reports/monthly?year=${month.year}&month=${month.month}`
      );
      setMonthlyReport(data);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    if (token) {
      loadReadings();
    }
  }, [token]);

  if (!token || !user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand-icon">🩸</div>
          <h1>Sweety</h1>
          <p className="subtitle">Your Personal Blood Glucose Tracker</p>

          <h2>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>

          <form onSubmit={handleAuth}>
            {mode === 'register' && (
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            )}

            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password (minimum 6 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength="6"
              required
            />

            <button type="submit" disabled={loading}>
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Login'
                  : 'Register'}
            </button>
          </form>

          {message && <p className="message">{message}</p>}

          <p className="switch-text">
            {mode === 'login'
              ? "Don't have an account?"
              : 'Already have an account?'}
            <button
              type="button"
              className="switch-button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setMessage('');
              }}
            >
              {mode === 'login' ? 'Register' : 'Login'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="topbar">
        <div className="brand">
          <span>🩸</span>
          <div>
            <h1>Sweety</h1>
            <small>Blood Glucose Tracker</small>
          </div>
        </div>
        <button className="logout-button" onClick={logout}>
          Logout
        </button>
      </header>

      <main className="dashboard">
        <section className="welcome-section">
          <div>
            <h2>Welcome, {user.name}!</h2>
            <p>Track your readings and view your glucose reports.</p>
          </div>
          <div className="welcome-icon">💙</div>
        </section>

        {message && (
          <div className="message dashboard-message">
            {message}
            <button onClick={() => setMessage('')}>×</button>
          </div>
        )}

        <section className="dashboard-grid">
          <div className="panel">
            <h3>➕ Add Glucose Reading</h3>
            <p className="panel-description">
              You can save up to 4 readings per day.
            </p>

            <form onSubmit={addReading}>
              <label>Glucose level (mg/dL)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Example: 120"
                value={glucose}
                onChange={(e) => setGlucose(e.target.value)}
                required
              />

              <label>Measurement date and time (optional)</label>
              <input
                type="datetime-local"
                value={measuredAt}
                onChange={(e) => setMeasuredAt(e.target.value)}
              />

              <button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save Reading'}
              </button>
            </form>
          </div>

          <div className="panel">
            <h3>📊 Reading Summary</h3>
            <div className="summary-number">{readings.length}</div>
            <p>Total readings recorded</p>
            <button className="secondary-button" onClick={loadReadings}>
              Refresh Readings
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <h3>📋 Reading History</h3>
            <span>{readings.length} records</span>
          </div>

          {readings.length === 0 ? (
            <p className="empty-state">No readings recorded yet.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Glucose (mg/dL)</th>
                    <th>Date</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((reading) => (
                    <tr key={reading.id}>
                      <td>{reading.glucose_level}</td>
                      <td>
                        {new Date(reading.measured_at).toLocaleDateString()}
                      </td>
                      <td>
                        {new Date(reading.measured_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="dashboard-grid">
          <div className="panel">
            <h3>📅 Daily Report</h3>
            <form onSubmit={getDailyReport}>
              <label>Select date</label>
              <input
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                required
              />
              <button type="submit">Generate Daily Report</button>
            </form>

            {dailyReport && (
              <div className="report-result">
                <h4>Report for {dailyReport.date}</h4>
                <p>Total readings: <strong>{dailyReport.report.total_readings}</strong></p>
                <p>Average: <strong>{dailyReport.report.average_glucose ?? 'N/A'}</strong></p>
                <p>Highest: <strong>{dailyReport.report.highest_glucose ?? 'N/A'}</strong></p>
                <p>Lowest: <strong>{dailyReport.report.lowest_glucose ?? 'N/A'}</strong></p>
              </div>
            )}
          </div>

          <div className="panel">
            <h3>🗓️ Monthly Report</h3>
            <form onSubmit={getMonthlyReport}>
              <label>Year</label>
              <input
                type="number"
                min="2000"
                max="2100"
                value={month.year}
                onChange={(e) =>
                  setMonth({ ...month, year: e.target.value })
                }
                required
              />

              <label>Month</label>
              <select
                value={month.month}
                onChange={(e) =>
                  setMonth({ ...month, month: e.target.value })
                }
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {new Date(2000, index).toLocaleString('en', {
                      month: 'long'
                    })}
                  </option>
                ))}
              </select>

              <button type="submit">Generate Monthly Report</button>
            </form>

            {monthlyReport && (
              <div className="report-result">
                <h4>
                  {monthlyReport.month}/{monthlyReport.year}
                </h4>
                <p>Total readings: <strong>{monthlyReport.report.total_readings}</strong></p>
                <p>Average: <strong>{monthlyReport.report.average_glucose ?? 'N/A'}</strong></p>
                <p>Highest: <strong>{monthlyReport.report.highest_glucose ?? 'N/A'}</strong></p>
                <p>Lowest: <strong>{monthlyReport.report.lowest_glucose ?? 'N/A'}</strong></p>

                <h4>Daily Breakdown</h4>
                {monthlyReport.daily_breakdown.length === 0 ? (
                  <p>No readings for this month.</p>
                ) : (
                  monthlyReport.daily_breakdown.map((day) => (
                    <p key={String(day.date)}>
                      {String(day.date).slice(0, 10)} — {day.total_readings} readings
                    </p>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="footer">
          Sweety – Personal Blood Glucose Tracker
        </footer>
      </main>
    </div>
  );
}

export default App;
