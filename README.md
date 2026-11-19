# Sweety – Blood Glucose Tracker

A full-stack web application that helps users record, manage, and monitor their blood glucose readings.

## Tech Stack

- Frontend: React.js, HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: PostgreSQL
- Authentication: JWT and bcrypt
- API Testing: Postman

## Features

- User registration and login
- Password hashing using bcrypt
- JWT-based authentication
- Add and view glucose readings
- Daily and monthly glucose reports
- PostgreSQL database integration
- Responsive dashboard

## Project Structure

```text
Sweety/
├── backend/
│   ├── db.js
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── .gitignore
└── README.md
```

## Requirements

- Node.js
- npm
- PostgreSQL
- Git

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/shreyasrs1108-alt/sweety-blood-glucose-tracker.git
cd sweety-blood-glucose-tracker
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create a `.env` file in the backend folder using `.env.example` as a reference and configure your PostgreSQL credentials.

Start the backend:

```bash
node server.js
```

Backend runs at:

`http://localhost:5000`

### 3. Frontend setup

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at:

`http://localhost:5173`

## Database Setup

1. Install and start PostgreSQL.
2. Create a database named `sweety`.
3. Configure the database connection in the backend `.env` file.
4. Start the backend server.

## Testing

API endpoints can be tested using Postman.

## Notes

This project was developed as part of a Junior Full Stack Developer assignment.

### Future Improvements

- Glucose trend charts
- Pagination
- Automated testing
- Additional reporting features
