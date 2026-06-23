import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute('SELECT id, status, predictionId, editType, createdAt, updatedAt, errorMessage FROM studio_jobs ORDER BY createdAt DESC LIMIT 5');
for (const row of rows) {
  console.log(JSON.stringify(row));
}
await conn.end();
process.exit(0);
