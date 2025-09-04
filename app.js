// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getStorage, ref as sRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// ================== Firebase Config ==================
const firebaseConfig = {
  apiKey: "AIzaSyD0uamDt3hfdZGsOjYjaoscMz91Oi47S0k",
  authDomain: "nckh---new-wave.firebaseapp.com",
  databaseURL: "https://nckh---new-wave-default-rtdb.firebaseio.com",
  projectId: "nckh---new-wave",
  storageBucket: "nckh---new-wave.firebasestorage.app",
  messagingSenderId: "431652182287",
  appId: "1:431652182287:web:5b390bce200ff50ab3467a",
  measurementId: "G-3X45XQHY9Q",
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const storage = getStorage(app);

// ================== Helpers ==================
const $ = (id) => document.getElementById(id);
const toNum = (v) => (v===''||v===null||v===undefined) ? NaN : Number(v);

// Chuẩn hoá key có gạch dưới thành có khoảng trắng (để map "Soil_moisture" → "Soil moisture")
const mapKeys = (o) => {
  if (!o || typeof o !== "object") return {};
  const out = {};
  Object.keys(o).forEach(k => {
    const nk = k.replaceAll("_"," ").replaceAll("  "," ");
    out[nk] = o[k];
  });
  return out;
};

// Nhận base64/URL và trả về src hợp lệ để gán <img>. Ưu tiên Blob URL (nhẹ RAM hơn dataURL).
function cameraToSrc(cam) {
  if (!cam) return null;

  // URL http(s)
  if (typeof cam === "string" && /^https?:\/\//i.test(cam)) return cam;

  // Đã là dataURL
  if (typeof cam === "string" && cam.startsWith("data:image")) return cam;

  // Base64 thuần → đoán mime theo signature
  if (typeof cam === "string") {
    const seemsPNG  = cam.startsWith("iVBORw0KGgo");
    const mime = seemsPNG ? "image/png" : "image/jpeg";
    try {
      const bin   = atob(cam);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn("Base64 parse error:", e);
      // Fallback dataURL
      return `data:${mime};base64,${cam}`;
    }
  }

  return null;
}

// Lấy plantId từ URL (mặc định Node_1)
const qs = new URLSearchParams(location.search);
const plantId = qs.get("plantId") || "Node_1";
$("plantIdChip")?.replaceChildren(document.createTextNode(`plantId: ${plantId}`));

// ================== LIVE SENSOR ==================
onValue(ref(db, `/${plantId}/Sensor`), (snap) => {
  const raw = snap.val() || {};
  const s = mapKeys(raw);

  const t = toNum(s["Temperature"]);
  const h = toNum(s["Humidity"]);
  const soil  = toNum(s["Soil moisture"] ?? s["Soil_moisture"]);
  const light = s["Light sensor"] ?? s["Light_sensor"];

  $("tempVal") && ($("tempVal").textContent = Number.isFinite(t) ? t : "—");
  $("humVal")  && ($("humVal").textContent  = Number.isFinite(h) ? h : "—");
  $("soilVal") && ($("soilVal").textContent = Number.isFinite(soil) ? soil : "—");
  $("lightVal")&& ($("lightVal").textContent= (light ?? "—"));

  // Ảnh
  const img = $("plantImage");
  const ts  = $("imgUpdated");
  const src = cameraToSrc(s.Camera);
  if (img && src) {
    img.src = src;
    img.classList.remove("hidden");
    ts && (ts.textContent = "Cập nhật ảnh: " + new Date().toLocaleString());
  } else if (img) {
    img.removeAttribute("src");
    img.classList.add("hidden");
    ts && (ts.textContent = "Đang chờ ảnh…");
  }

  $("lastUpdated") && ($("lastUpdated").textContent = new Date().toLocaleString());
});

// ================== LIVE TIME (nếu cần) ==================
onValue(ref(db, `/${plantId}/Time`), (snap) => {
  // tuỳ UI của bạn, thêm các trường nếu cần
  // const t = mapKeys(snap.val() || {});
});

// ================== QR: Render + (tuỳ chọn) Upload ==================
async function renderAndUploadQR() {
  const qrHolder = $("qrcode");
  const qrStatus = $("qrStatus");
  if (!qrHolder) return;

  // URL mục tiêu khi quét QR (mở lại chính trang này kèm plantId)
  const siteUrl = `${window.location.origin}${window.location.pathname}?plantId=${encodeURIComponent(plantId)}`;

  qrHolder.innerHTML = ""; // xoá QR cũ
  try {
    // Đảm bảo QRCode đã sẵn sàng
    if (typeof window.QRCode !== "function") {
      await new Promise(r => setTimeout(r, 50));
    }

    // Vẽ
    const qr = new window.QRCode(qrHolder, {
      text: siteUrl,
      width: 200,
      height: 200,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.H
    });

    // Chờ canvas render
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function wait(){
        const cv = qrHolder.querySelector("canvas");
        if (cv) return resolve();
        if (Date.now() - t0 > 2000) return reject(new Error("QR canvas timeout"));
        requestAnimationFrame(wait);
      })();
    });

    // Lấy base64 PNG từ canvas
    const canvas = qrHolder.querySelector("canvas");
    const dataURL = canvas.toDataURL("image/png");

    // ===== TUỲ CHỌN: upload QR lên Storage và ghi link về DB =====
    const storagePath = `qr/${plantId}.png`;
    const storageRef  = sRef(storage, storagePath);
    await uploadString(storageRef, dataURL, "data_url");
    const downloadURL = await getDownloadURL(storageRef);

    // Ghi thẳng vào /<plantId>/QR (đúng nhánh bạn đang dùng theo screenshot)
    await set(ref(db, `/${plantId}/QR`), downloadURL);

    // (Thêm metadata tổng quát nếu muốn)
    await update(ref(db, `/QR/${plantId}`), {
      siteUrl,
      qrImage: downloadURL,
      updatedAt: new Date().toISOString()
    });

    qrStatus && (qrStatus.textContent = `✅ Đã tạo & upload QR, lưu link tại /${plantId}/QR`);
  } catch (err) {
    console.error("QR upload error:", err);
    qrStatus && (qrStatus.textContent = "❌ Lỗi khi tạo/upload QR: " + err.message);
  }
}

// ================== Events ==================
document.addEventListener("DOMContentLoaded", () => {
  renderAndUploadQR();
  $("btnRefresh")?.addEventListener("click", renderAndUploadQR);
});
