const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const db = require("./db");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

/* Bills */
ipcMain.handle("get-bills", async (_, date) => {
  const [rows] = await db.query(
    `SELECT TxnID, TxnNo, table_name, Amount, BilledDate
     FROM taxntrnbill
     WHERE DATE(BilledDate)=?`,
    [date]
  );

  return rows;
});

/* Bill Details */
ipcMain.handle("get-bill-details", async (_, txnId) => {
  const [rows] = await db.query(
    `SELECT *
     FROM taxntrnbilldetails
     WHERE TxnID=? AND isCancelled=0`,
    [txnId]
  );

  return rows;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});