const mysql = require("mysql2/promise");
const { settings } = require("./config");

function assertDatabaseConfig() {
  if (settings.dbHost && settings.dbUser && settings.dbName) {
    return;
  }

  throw new Error(
    "Mini app DB configuration ontbreekt. Stel MINI_APP_DB_HOST, MINI_APP_DB_USER, MINI_APP_DB_PASS en MINI_APP_DB_NAME in."
  );
}

async function withConnection(callback) {
  assertDatabaseConfig();

  const connection = await mysql.createConnection({
    host: settings.dbHost,
    user: settings.dbUser,
    password: settings.dbPass,
    database: settings.dbName,
    charset: "utf8mb4",
  });

  try {
    return await callback(connection);
  } finally {
    await connection.end();
  }
}

async function query(sql, params = []) {
  return withConnection(async (connection) => {
    const [rows] = await connection.query(sql, params);
    return rows;
  });
}

module.exports = {
  query,
};
