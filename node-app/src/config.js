const settings = {
  appName: "mini app",
  port: Number(process.env.PORT || 3000),
  dbHost: process.env.MINI_APP_DB_HOST,
  dbUser: process.env.MINI_APP_DB_USER,
  dbPass: process.env.MINI_APP_DB_PASS,
  dbName: process.env.MINI_APP_DB_NAME,
  billitBaseUrl: process.env.BILLIT_BASE_URL || "https://app.billit.eu",
};

module.exports = { settings };
