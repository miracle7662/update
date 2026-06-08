import mysql from "mysql2";

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "sharmin",
  database: "restaurant_db",
});

export default pool;