import { useState, useMemo, useCallback, useEffect } from "react";
import axios from "axios";

/* ─── TYPES ──────────────────────────────────────────────────────── */
interface Bill {
  TxnID: number;
  TxnNo: number;
  Amount: number;
  TxnDatetime: string;
}

interface BillDetail {
  TXnDetailID: number;
  KOTNo: number | null;
  item_no: number;
  item_name: string;
  RuntimeRate: number;
  Qty: number;
}

interface OrderRow {
  txnId: number;
  billNo: number | null;
  kotNo: number | null;
  manual: number | null;
  itemNo: number;
  item: string;
  rate: number;
  qty: number;
  upd: number;
  txnDetailId?: number;
}

interface Department {
  departmentid: number;
  department_name: string;
}

/* ─── API CONFIGURATION ──────────────────────────────────────────── */
const API_BASE_URL = "http://localhost:3001/api/billing-transfer";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

/* ─── COMPONENT ──────────────────────────────────────────────────── */
export default function BillingDashboard() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [outletId] = useState<number>(16);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [bills, setBills] = useState<Bill[]>([]);
  const [billDetails, setBillDetails] = useState<Record<number, BillDetail[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState<Record<number, boolean>>({});

  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [transferred, setTransferred] = useState<number[]>([]);
  const [updValues, setUpdValues] = useState<Record<number, string>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<number, number>>({});
  const [originalQty, setOriginalQty] = useState<Record<number, number>>({});
  const [cashTotal, setCashTotal] = useState(0);
  const [creditTotal, setCreditTotal] = useState(0);
  const [billingTotal, setBillingTotal] = useState(0);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const response = await api.get("/departments", { params: { outletid: outletId } });
      setDepartments(response.data);
      if (response.data.length > 0) {
        setSelectedDept(response.data[0].departmentid.toString());
      }
    } catch (error) {
      console.error("❌ Error fetching departments:", error);
    }
  };

  const fetchBills = async () => {
    if (!selectedDept) { alert("Please select a department first"); return; }
    setLoading(true);
    try {
      const response = await api.get("/bills", {
        params: { date, departmentid: selectedDept, outletid: outletId },
      });
      setBills(response.data.bills);
      setCashTotal(response.data.cashTotal);
      setCreditTotal(response.data.creditTotal);
      setBillingTotal(response.data.billingTotal);
      setChecked({});
      setTransferred([]);
      setBillDetails({});
    } catch (error) {
      console.error("❌ Error fetching bills:", error);
      alert("Failed to fetch bills. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchBillDetails = async (txnId: number) => {
    if (billDetails[txnId]) return;
    setLoadingDetails((prev) => ({ ...prev, [txnId]: true }));
    try {
      const response = await api.get(`/bill-details/${txnId}`);
      setBillDetails((prev) => ({ ...prev, [txnId]: response.data }));
    } catch (error) {
      console.error(`❌ Error fetching details for bill ${txnId}:`, error);
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [txnId]: false }));
    }
  };

  const convertToOrderRows = useCallback(
    (details: BillDetail[], txnId: number): OrderRow[] => {
      const bill = bills.find((b) => b.TxnID === txnId);
      const displayBillNo = bill ? bill.TxnNo : txnId;
      return details.map((detail) => ({
        txnId,
        billNo: displayBillNo,
        kotNo: detail.KOTNo,
        manual: detail.KOTNo,
        itemNo: detail.item_no,
        item: detail.item_name,
        rate: detail.RuntimeRate,
        qty: detail.Qty,
        upd: 0,
        txnDetailId: detail.TXnDetailID,
      }));
    },
    [bills]
  );

  const visibleOrders = useMemo(() => {
    if (transferred.length === 0) return [];
    const orders: OrderRow[] = [];
    for (const txnId of transferred) {
      const details = billDetails[txnId];
      if (details && details.length > 0) {
        orders.push(...convertToOrderRows(details, txnId));
      }
    }
    return orders;
  }, [transferred, billDetails, convertToOrderRows]);

  const selectedTotal = (bills ?? [])
    .filter((b) => !!checked?.[b.TxnID])
    .reduce((a, b) => a + (b?.Amount ?? 0), 0);
  const systemCash = Math.round(billingTotal * 0.42);
  const systemCredit = Math.round(billingTotal * 0.58);
  const systemDiff = billingTotal - (systemCash + systemCredit);


  // ✅ REAL-TIME REDUCTION CALCULATION (frontend only)
  const reductionStats = useMemo(() => {
    if (transferred.length === 0) {
      return { originalTotal: 0, reducedAmount: 0, newTotal: 0 };
    }
    const originalTotal = bills
      .filter((b) => transferred.includes(b.TxnID))
      .reduce((sum, b) => sum + b.Amount, 0);

    let totalReduced = 0;
    visibleOrders.forEach((row, idx) => {
      const finalQty = qtyOverride[idx] !== undefined ? qtyOverride[idx] : row.qty;
      const origQty = originalQty[idx] !== undefined ? originalQty[idx] : row.qty;
      const cancelled = Math.max(0, origQty - finalQty);
      totalReduced += cancelled * row.rate;
    });
    return { originalTotal, reducedAmount: totalReduced, newTotal: originalTotal - totalReduced };
  }, [transferred, bills, visibleOrders, qtyOverride, originalQty]);

  const resetState = () => {
    setChecked({});
    setTransferred([]);
    setUpdValues({});
    setQtyOverride({});
    setOriginalQty({});
    setBillDetails({});
  };

  const handleDateChange = (d: string) => { setDate(d); resetState(); };
  const handleDepartmentChange = (deptId: string) => { setSelectedDept(deptId); resetState(); };

  const toggle = useCallback((txnId: number) => {
    setChecked((p) => ({ ...p, [txnId]: !p[txnId] }));
  }, []);

  const toggleAll = () => {
    const allChecked = bills.every((b) => checked[b.TxnID]);
    const next: Record<number, boolean> = {};
    if (!allChecked) bills.forEach((b) => (next[b.TxnID] = true));
    setChecked(next);
  };

  const handleTransfer = async () => {
    const selected = bills.filter((b) => checked[b.TxnID]).map((b) => b.TxnID);
    if (selected.length === 0) { alert("Please select at least one bill to transfer"); return; }
    for (const txnId of selected) await fetchBillDetails(txnId);
    setTransferred(selected);
    setUpdValues({});
    setQtyOverride({});
    setOriginalQty({});
  };

  const clearTransferred = () => {
    setTransferred([]);
    setUpdValues({});
    setQtyOverride({});
    setOriginalQty({});
  };

  const handleUpdChange = useCallback(
    (globalIdx: number, origQty: number, raw: string) => {
      const clean = raw.replace(/\D/g, "");
      setUpdValues((p) => ({ ...p, [globalIdx]: clean }));
      let typed = clean === "" ? 0 : parseInt(clean, 10);
      if (typed > origQty) typed = origQty;
      const newQty = origQty - typed;
      setQtyOverride((p) => ({ ...p, [globalIdx]: newQty }));
      if (originalQty[globalIdx] === undefined) {
        setOriginalQty((p) => ({ ...p, [globalIdx]: origQty }));
      }
    },
    [originalQty]
  );

  const autoFillUpdateColumn = useCallback(() => {
    if (visibleOrders.length === 0) return;
    const newUpdValues: Record<number, string> = {};
    const newQtyOverride: Record<number, number> = {};
    const newOriginalQty: Record<number, number> = {};

    let currentBillNo: number | null = null;
    visibleOrders.forEach((row, idx) => {
      const isFirstRowOfBill = row.billNo !== currentBillNo;
      if (isFirstRowOfBill) currentBillNo = row.billNo;

      const origQty = row.qty;
      let updValue: number;
      if (isFirstRowOfBill) {
        updValue = Math.max(0, origQty - 1);
      } else {
        updValue = origQty;
      }
      newUpdValues[idx] = updValue.toString();
      newQtyOverride[idx] = origQty - updValue;
      newOriginalQty[idx] = origQty;
    });

    setUpdValues(newUpdValues);
    setQtyOverride(newQtyOverride);
    setOriginalQty(newOriginalQty);
  }, [visibleOrders]);

  const handleUpdateAll = async () => {
    const updates = visibleOrders
      .map((row, idx) => {
        const newQty = qtyOverride[idx];
        const origQty = originalQty[idx] ?? row.qty;
        if (newQty !== undefined && newQty !== origQty && row.txnDetailId) {
          return { txnDetailId: row.txnDetailId, newQty };
        }
        return null;
      })
      .filter(Boolean);

    if (updates.length === 0) {
      alert("No changes to update");
      return;
    }

    // Validation: each bill must have at least one item with qty > 0
    const billFinalQtys: Record<number, number[]> = {};
    for (let idx = 0; idx < visibleOrders.length; idx++) {
      const row = visibleOrders[idx];
      const finalQty = qtyOverride[idx] !== undefined ? qtyOverride[idx] : row.qty;
      if (!billFinalQtys[row.billNo!]) billFinalQtys[row.billNo!] = [];
      billFinalQtys[row.billNo!].push(finalQty);
    }
    for (const billNo in billFinalQtys) {
      const allZero = billFinalQtys[billNo].every(qty => qty === 0);
      if (allZero) {
        alert(`Cannot cancel all items in Bill #${billNo}. At least one item must remain with positive quantity.`);
        return;
      }
    }

    try {
      setLoading(true);
      const res = await api.post("/bill-details/update-qty", { updates });
      if (res.data?.success) {
        alert("✅ Updated & Recalculated Successfully");
        await fetchBills();
        setBillDetails({});
        setQtyOverride({});
        setOriginalQty({});
        setTransferred([]);
      } else {
        alert("❌ Update failed");
      }
    } catch (error: any) {
      console.error("Update error:", error);
      alert(error?.response?.data?.error || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (datetime?: string) =>
    new Date(datetime ?? date).toLocaleDateString("en-IN", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
    });

  return (
    <div style={{ fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif", background: "#f0f2f5", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .wrap{max-width:1340px;margin:0 auto;}
        .topbar{background:#1a56a0;padding:0 16px;display:flex;align-items:center;gap:14px;height:44px;border-bottom:3px solid #0e3d7a;flex-wrap:wrap;}
        .topbar-title{color:#fff;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
        .ctrl-select,.ctrl-date{height:28px;border:1px solid #a8b5c5;border-radius:4px;background:#fff;font-family:'IBM Plex Sans',sans-serif;font-size:12px;color:#2c3e50;padding:0 8px;outline:none;}
        .ctrl-select:focus,.ctrl-date:focus{border-color:#f0b429;}
        .diff-badge{color:#c0392b;font-weight:700;font-size:13px;background:#fff5f5;border:1.5px solid #feb2b2;border-radius:5px;padding:3px 10px;}
        .sum-table{border-collapse:collapse;}
        .sum-table th{background:linear-gradient(180deg,#dde6f0,#cdd8e6);border:1px solid #b0bece;padding:5px 10px;font-size:11px;font-weight:700;color:#2c3e50;text-align:center;letter-spacing:.04em;}
        .sum-table td{border:1px solid #c8d3de;padding:5px 10px;font-size:13px;font-family:'IBM Plex Mono',monospace;text-align:right;color:#1a2a3a;font-weight:500;}
        .sum-table td.lbl{text-align:left;font-family:'IBM Plex Sans',sans-serif;font-weight:600;font-size:12px;color:#3a4a5c;}
        .sum-table tr.total-row td{background:#fff8e1;font-weight:700;color:#b45309;border-top:2px solid #e0b840;}
        .sum-table tr.food-row td{background:#f0f7ff;}
        .sum-table tr.bar-row td{background:#fafafa;}
        .action-btn{border-radius:5px;font-family:'IBM Plex Sans',sans-serif;font-weight:700;font-size:13px;cursor:pointer;transition:filter .15s,transform .1s;letter-spacing:.03em;box-shadow:0 2px 4px rgba(0,0,0,.18);display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2;}
        .action-btn:hover{filter:brightness(1.08);transform:translateY(-1px);}
        .action-btn:active{transform:translateY(0);filter:brightness(.96);}
        .btn-show{background:linear-gradient(180deg,#4a90d9,#2a6db5);color:#fff;border:1px solid #1e57a0;}
        .btn-test{background:linear-gradient(180deg,#f0b429,#d97706);color:#fff;border:1px solid #b45309;}
        .btn-update{background:linear-gradient(180deg,#e53e3e,#c53030);color:#fff;border:1px solid #9b2c2c;}
        .btn-transfer{background:linear-gradient(180deg,#a78bfa,#7c3aed);color:#fff;border:1px solid #5b21b6;width:100%;}
        .sel-btn{height:26px;padding:0 10px;border-radius:4px;border:1px solid #a8b5c5;background:linear-gradient(180deg,#f5f8fc,#e8edf4);font-size:11px;font-weight:700;color:#2c3e50;cursor:pointer;letter-spacing:.04em;}
        .sel-btn:hover{background:linear-gradient(180deg,#e8f0fc,#d5e0f0);}
        .sel-btn.all{background:linear-gradient(180deg,#fffbeb,#fef3c7);border-color:#d97706;color:#92400e;}
        .bill-list{border-collapse:collapse;width:100%;}
        .bill-list th{background:linear-gradient(180deg,#dde6f0,#cdd8e6);border:1px solid #b0bece;padding:5px 8px;font-size:11px;font-weight:700;color:#2c3e50;letter-spacing:.04em;}
        .bill-list td{border:1px solid #d4dbe5;padding:4px 8px;font-size:12px;font-family:'IBM Plex Mono',monospace;color:#1a2a3a;}
        .bill-list tr.sel td{background:#fffbeb;}
        .bill-list tr.transferred td{background:#f0fdf4;}
        .bill-list tr:hover td{background:#f0f6ff;cursor:pointer;}
        .order-table{width:100%;border-collapse:collapse;font-size:12px;}
        .order-table th{background:linear-gradient(180deg,#dde6f0,#cdd8e6);border:1px solid #b0bece;padding:5px 9px;font-size:11px;font-weight:700;color:#2c3e50;text-align:left;letter-spacing:.04em;white-space:nowrap;}
        .order-table th.num{text-align:right;}
        .order-table td{border:1px solid #d4dbe5;padding:4px 9px;font-family:'IBM Plex Mono',monospace;color:#1a2a3a;white-space:nowrap;}
        .order-table td.name{font-family:'IBM Plex Sans',sans-serif;color:#1e3a5f;font-weight:500;}
        .order-table td.num{text-align:right;}
        .order-table td.bill-no{font-weight:700;color:#1a56a0;}
        .order-table td.rate{color:#166534;font-weight:600;}
        .order-table td.qty{color:#92400e;font-weight:600;text-align:center;}
        .bill-group-start td{border-top:3px solid #1a56a0 !important;}
        .bill-group-start td.bill-no-cell{background:#e8f0fb;}
        .upd-cell{text-align:center;min-width:70px;}
        .upd-cell input{width:60px;border:1px solid #d4dbe5;border-radius:4px;padding:4px 6px;text-align:center;font-family:inherit;font-size:12px;}
        .upd-cell input:focus{outline:none;border-color:#f0b429;box-shadow:0 0 0 1px #f0b429;}
        .empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:13px;gap:8px;}
        .bill-scroll{max-height:300px;overflow-y:auto;}
        .order-scroll{max-height:380px;overflow-y:auto;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#f1f1f1;}
        ::-webkit-scrollbar-thumb{background:#b0bece;border-radius:3px;}
        .badge-green{background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700;}
        .badge-blue{background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700;}
        .loading-spinner{display:inline-block;width:12px;height:12px;border:2px solid #f3f3f3;border-top:2px solid #1a56a0;border-radius:50%;animation:spin 1s linear infinite;margin-right:5px;}
        @keyframes spin{0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}
      `}</style>

      <div className="wrap">
        {/* TOP BAR - EXACT ORIGINAL LAYOUT */}
        <div className="topbar">
          <span className="topbar-title">📋 Billing Dept</span>
          <div style={{ height: 20, width: 1, background: "rgba(255,255,255,.3)" }} />
          <div style={{ color: "#fff", fontSize: "12px", background: "#0e3d7a", padding: "2px 8px", borderRadius: "4px" }}>
            Outlet: {outletId}
          </div>
          <select className="ctrl-select" value={selectedDept} onChange={(e) => handleDepartmentChange(e.target.value)}>
            <option value="">Select Department</option>
            {departments.map((dept) => (
              <option key={dept.departmentid} value={dept.departmentid}>{dept.department_name}</option>
            ))}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: "#c8d8ee", fontSize: 11, fontWeight: 600 }}>Date</span>
            <input className="ctrl-date" type="date" value={date} onChange={(e) => handleDateChange(e.target.value)} />
          </div>
          <button className="action-btn btn-show" onClick={fetchBills} style={{ padding: "4px 18px", fontSize: 13, height: 30 }} disabled={!selectedDept}>
            SHOW
          </button>

          {/* ✅ REUSED DIFFERENCE BADGE – now also shows reduced amount */}
          <span className="diff-badge">
           
            {transferred.length > 0 && reductionStats.reducedAmount > 0 && (
              <> | 🔻 REDUCED ₹{reductionStats.reducedAmount.toLocaleString()}</>
            )}
          </span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#c8d8ee", fontSize: 11 }}>{formatDate()}</span>
            <span className="badge-blue">{(bills ?? []).length} Bills</span>

          </div>
        </div>

        {/* SUMMARY ROW – UNCHANGED (no extra cards) */}
        <div style={{ background: "#fff", borderBottom: "2px solid #cdd5e0", padding: "10px 16px", display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#3a4a5c", letterSpacing: ".06em", marginBottom: 4, textTransform: "uppercase" }}>Billing</div>
            <table className="sum-table" style={{ width: 260 }}>
              <thead>
                <tr><th>Type</th><th>Cash</th><th>Credit</th><th>Total</th></tr>
              </thead>
              <tbody>
                <tr className="food-row"><td className="lbl">Food</td><td>{cashTotal.toLocaleString()}</td><td>{creditTotal.toLocaleString()}</td><td>{(cashTotal + creditTotal).toLocaleString()}</td></tr>
                <tr className="bar-row"><td className="lbl">Bar</td><td>0</td><td>0</td><td>0</td></tr>
                <tr className="total-row"><td className="lbl">Total</td><td>{cashTotal.toLocaleString()}</td><td>{creditTotal.toLocaleString()}</td><td>{(cashTotal + creditTotal).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#3a4a5c", letterSpacing: ".06em", marginBottom: 4, textTransform: "uppercase" }}>System</div>
            <table className="sum-table" style={{ width: 260 }}>
              <thead><tr><th>Type</th><th>Cash</th><th>Credit</th><th>Total</th></tr></thead>
              <tbody>
                <tr className="food-row"><td className="lbl">Food</td><td>{systemCash.toLocaleString()}</td><td>{systemCredit.toLocaleString()}</td><td>{(systemCash + systemCredit).toLocaleString()}</td></tr>
                <tr className="bar-row"><td className="lbl">Bar</td><td>0</td><td>0</td><td>0</td></tr>
                <tr className="total-row"><td className="lbl">Total</td><td>{systemCash.toLocaleString()}</td><td>{systemCredit.toLocaleString()}</td><td>{(systemCash + systemCredit).toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignSelf: "center", marginLeft: 8 }}>
            <button className="action-btn btn-test" style={{ padding: "8px 26px" }}>TEST</button>
            <button className="action-btn btn-update" onClick={handleUpdateAll} style={{ padding: "8px 26px" }}>UPDATE</button>
          </div>
        </div>

        {/* MAIN BODY – SAME ORIGINAL STRUCTURE */}
        <div style={{ display: "flex", gap: 0, background: "#f0f2f5", padding: 10, alignItems: "flex-start" }}>
          {/* LEFT: Bill List */}
          <div style={{ width: 220, flexShrink: 0, marginRight: 8 }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              <button className="sel-btn" onClick={fetchBills}>Refresh</button>
              <button className="sel-btn all" onClick={toggleAll}>Select All</button>
            </div>
            <div style={{ background: "#fff", border: "1px solid #cdd5e0", borderRadius: 4, overflow: "hidden" }}>
              <div className="bill-scroll">
                {loading ? (
                  <div className="empty-state"><div className="loading-spinner"></div><span>Loading bills...</span></div>
                ) : bills.length === 0 ? (
                  <div className="empty-state"><span>📭</span><span>No bills for this date</span><span style={{ fontSize: 11, color: "#cbd5e1" }}>Select department and click SHOW</span></div>
                ) : (
                  <table className="bill-list" style={{ tableLayout: "fixed", width: "100%" }}>
                    <colgroup><col style={{ width: 70 }} /><col style={{ width: 50 }} /><col style={{ width: 34 }} /></colgroup>
                    <thead><tr><th>Bill No</th><th style={{ textAlign: "right" }}>Amount</th><th>✓</th></tr></thead>
                    <tbody>
                      {bills.map((b) => (
                        <tr key={b.TxnID} className={transferred.includes(b.TxnID) ? "transferred" : checked[b.TxnID] ? "sel" : ""} onClick={() => toggle(b.TxnID)}>
                          <td>{b.TxnNo}</td><td style={{ textAlign: "right" }}>{b.Amount}</td>
                          <td style={{ textAlign: "center", padding: "4px 2px" }}>
                            <input type="checkbox" checked={!!checked[b.TxnID]} onChange={() => toggle(b.TxnID)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "#1a56a0", width: 13, height: 13 }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            {bills.length > 0 && (
              <div style={{ marginTop: 6, background: "#fff", border: "1px solid #cdd5e0", borderRadius: 4, padding: "5px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#6b7280" }}>Selected</span>
                <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: "#b45309" }}>₹{selectedTotal.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* MIDDLE: Transfer button */}
          <div style={{ width: 38, flexShrink: 0, marginRight: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 32 }}>
            <button className="action-btn btn-transfer" style={{ padding: "10px 0", writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)", letterSpacing: ".1em", fontSize: 12, height: 120 }} onClick={handleTransfer}>Transfer</button>
            {transferred.length > 0 && <span className="badge-green" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", letterSpacing: ".06em", padding: "4px 3px", fontSize: 10 }}>{transferred.length} bills</span>}
          </div>

          {/* RIGHT: Order Details */}
          <div style={{ flex: 1 }}>
            <div style={{ background: "#fff", border: "1px solid #cdd5e0", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(180deg,#e8ecf2,#dde2ea)", borderBottom: "2px solid #b4bfcc", padding: "5px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {transferred.length > 0 && <button className="sel-btn" style={{ fontSize: 10, height: 24, padding: "0 8px", color: "#dc2626", borderColor: "#fca5a5" }} onClick={clearTransferred}>✕ Clear</button>}
              </div>
              <div className="order-scroll">
                {visibleOrders.length === 0 ? (
                  <div className="empty-state"><span style={{ fontSize: 28 }}>👈</span><span>Select bills from left &amp; click <strong>Transfer</strong></span><span style={{ fontSize: 11, color: "#cbd5e1" }}>Order details will appear here</span></div>
                ) : (
                  <table className="order-table">
                    <thead>
                      <tr>
                        <th>BillNo</th><th>KOTNo</th><th>Manual</th><th>ItemNo</th><th>Item</th><th className="num">Rate</th><th className="num">Qty</th>
                        <th className="num">
                          UpDate
                          <button onClick={autoFillUpdateColumn} style={{ marginLeft: "8px", fontSize: "10px", padding: "2px 6px", background: "#e2e8f0", border: "1px solid #94a3b8", borderRadius: "3px", cursor: "pointer", fontWeight: "bold" }}>All</button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let currentBillNo: number | null = null;
                        return visibleOrders.map((row, globalIdx) => {
                          const isBillStart = row.billNo !== currentBillNo;
                          if (isBillStart) currentBillNo = row.billNo;
                          const displayQty = qtyOverride[globalIdx] !== undefined ? qtyOverride[globalIdx] : row.qty;
                          const isLoading = loadingDetails[row.txnId];
                          return (
                            <tr key={globalIdx} className={isBillStart ? "bill-group-start" : ""}>
                              <td className={`bill-no ${isBillStart ? "bill-no-cell" : ""}`}>{isBillStart ? row.billNo : ""}</td>
                              <td>{row.kotNo ?? ""}</td><td>{row.manual ?? ""}</td>
                              <td style={{ color: "#6b7280" }}>{row.itemNo}</td>
                              <td className="name">{row.item}</td>
                              <td className="rate num">₹{row.rate}</td>
                              <td className="qty">{isLoading ? <div className="loading-spinner"></div> : displayQty}</td>
                              <td className="upd-cell">
                                <input type="text" value={updValues[globalIdx] !== undefined ? updValues[globalIdx] : ""} onChange={(e) => handleUpdChange(globalIdx, row.qty, e.target.value)} onKeyDown={(e) => { const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Enter"]; if (!/^\d$/.test(e.key) && !allowed.includes(e.key)) e.preventDefault(); }} onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData("text").replace(/\D/g, ""); document.execCommand("insertText", false, text); }} />
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FOOTER – UNCHANGED */}
        <div style={{ background: "#fff", borderTop: "1px solid #cdd5e0", padding: "5px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Outlet: {outletId} · {formatDate()}</span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>Bills: {bills.length} | Selected: {bills.filter((b) => checked[b.TxnID]).length} | Transferred: {transferred.length} | ₹{selectedTotal.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}