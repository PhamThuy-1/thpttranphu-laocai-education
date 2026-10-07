// =======================================================
// CẤU HÌNH API & TÀI KHOẢN (THAY LINK WEB APP MỚI NHẤT VÀO ĐÂY)
// =======================================================
const SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbwo0e6Wz_zQFih0X3FhizMBNNSt8SVzf-F-sc9YSLdVPX4ra_-tSUXa2TrvMIkHA5RX/exec";
const GOOGLE_CLIENT_ID = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";

let appData = {
  staff: [], tasks: [], registrations: [], bghEmails: []
};

let currentUser = null;
let currentModule = "home";
let bghActiveTab = "grading";
let bghPage = 1, bghItemsPerPage = 10;
let currentKpiTab = "all", currentPage = 1, itemsPerPage = 10;

// =======================================================
// KHỞI TẠO ỨNG DỤNG & DEBUG TOÀN BỘ
// =======================================================
window.onload = function() {
  console.log("🚀 [DEBUG] Web đang khởi động...");
  const now = new Date();
  const badge = document.getElementById("current-date-badge");
  if (badge) badge.innerText = `📅 Ngày ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  if (window.google) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLoginResponse });
    google.accounts.id.renderButton(document.getElementById("google-signin-btn"), { theme: "outline", size: "large", width: 280, text: "signin_with" });
    console.log("✅ [DEBUG] Google Sign-In SDK đã sẵn sàng.");
  }
  goToHome();
  fetchRemoteDataViaJsonp(); // Gọi dữ liệu bằng JSONP để tránh triệt để lỗi CORS và 404
};

// =======================================================
// GỌI DỮ LIỆU BẰNG JSONP (KHÔNG BAO GIỜ BỊ LỖI CORS HAY 404)
// =======================================================
function fetchRemoteDataViaJsonp() {
  console.log("📡 [DEBUG] Đang tải dữ liệu từ Google Sheet qua JSONP...");
  const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());

  window[callbackName] = function(json) {
    delete window[callbackName];
    document.body.removeChild(script);

    console.log("📥 [DEBUG] Dữ liệu thô nhận từ Google Sheet:", json);

    if (json && json.success) {
      appData.tasks = json.tasks || [];
      appData.registrations = json.registrations || [];
      appData.staff = json.staff || [];
      appData.bghEmails = json.bghEmails || [];

      // 🔍 IN RA TOÀN BỘ DANH SÁCH TÀI KHOẢN GIÁO VIÊN VÀ BGH ĐỂ KIỂM TRA TRỰC QUAN
      console.log("==================================================");
      console.log("📋 DANH SÁCH NHÂN SỰ ĐÃ TẢI XUỐNG TỪ SHEET:");
      console.table(appData.staff);
      console.log("👑 DANH SÁCH EMAIL BGH ĐÃ TẢI XUỐNG:", appData.bghEmails);
      console.log("==================================================");

    } else {
      console.error("❌ [DEBUG] Lỗi dữ liệu từ Sheet:", json ? json.error : "Không có phản hồi");
    }

    if (currentUser) renderAppView();
  };

  const script = document.createElement('script');
  script.src = `${SCRIPT_API_URL}?action=getInitialData&callback=${callbackName}`;
  script.onerror = function(err) {
    console.error("❌ [DEBUG] Không thể kết nối tới Google Script API. Hãy kiểm tra lại link Web App!", err);
  };
  document.body.appendChild(script);
}

// =======================================================
// ĐĂNG NHẬP & PHÂN QUYỀN
// =======================================================
function parseJwt(token) {
  try {
    return JSON.parse(decodeURIComponent(escape(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
  } catch (e) { return null; }
}

function handleGoogleLoginResponse(response) {
  const payload = parseJwt(response.credential);
  if (payload) {
    console.log("👤 [DEBUG] Người dùng vừa bấm đăng nhập với email:", payload.email);
    processUserSession(payload.email, payload.name, payload.picture);
  }
}

function processUserSession(email, name, avatar) {
  const lowerEmail = email.toLowerCase().trim();
  console.log("🔎 [DEBUG] Đang tìm email:", lowerEmail, "trong danh sách nhân sự...");

  // Kiểm tra BGH
  const isBgh = appData.bghEmails.map(e => e.toLowerCase().trim()).includes(lowerEmail);

  // Tìm trong staff
  let staffProfile = appData.staff.find(s => s.email && s.email.toLowerCase().trim() === lowerEmail);

  let role = isBgh ? "BGH" : "GV";
  let code = staffProfile ? staffProfile.code : (isBgh ? "BGH" : "GV_NEW");
  let realName = staffProfile ? staffProfile.name : name;

  if (!staffProfile) {
    console.warn(`⚠️ [DEBUG] CẢNH BÁO: Email '${lowerEmail}' KHÔNG TỒN TẠI trong bảng Nhân sự/KPI cố định của Sheet! Trạng thái hiện tại sẽ là GV_NEW.`);
  } else {
    console.log(`✅ [DEBUG] KHỚP THÀNH CÔNG! Mã: ${code} | Tên: ${realName} | Vai trò: ${role}`);
  }

  currentUser = {
    email: lowerEmail,
    name: realName,
    code: code,
    role: role,
    avatar: avatar
  };

  closeLoginModal();
  renderAppView();
}

function logout() {
  currentUser = null;
  document.getElementById("user-info-bar").classList.add("hidden");
  document.getElementById("nav-guest-box").classList.remove("hidden");
  goToHome();
}

// =======================================================
// ĐIỀU HƯỚNG & GIAO DIỆN
// =======================================================
function renderAppView() {
  if (!currentUser) return;
  document.getElementById("nav-guest-box").classList.add("hidden");
  document.getElementById("user-info-bar").classList.remove("hidden");
  document.getElementById("user-display-name").innerText = currentUser.name;
  document.getElementById("user-avatar").src = currentUser.avatar;

  const roleBadge = document.getElementById("user-role-badge");
  if (currentUser.role === "BGH") {
    roleBadge.innerText = "Ban Giám Hiệu";
    roleBadge.className = "inline-block mt-1 text-[11px] px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800";
  } else {
    roleBadge.innerText = `Giáo Viên (${currentUser.code})`;
    roleBadge.className = "inline-block mt-1 text-[11px] px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700";
  }

  const bghCard = document.getElementById("card-kpi-bgh");
  if (bghCard) bghCard.classList.toggle("hidden", currentUser.role !== "BGH");

  if (currentModule !== "home") navigateToModule(currentModule);
  else goToHome();
}

function hideAllSections() {
  ["portal", "teacher", "bgh", "students", "leave", "equipment"].forEach(sec => {
    const el = document.getElementById(`${sec}-section`);
    if (el) el.classList.add("hidden");
  });
}

function goToHome() {
  currentModule = "home";
  hideAllSections();
  document.getElementById("portal-section").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigateToModule(moduleKey) {
  if (!currentUser) { openLoginModal("Vui lòng đăng nhập để tiếp tục."); return; }
  currentModule = moduleKey;
  hideAllSections();

  if (moduleKey === "kpi_me") {
    document.getElementById("teacher-section").classList.remove("hidden");
    renderTeacherDashboard();
  } else if (moduleKey === "kpi_bgh") {
    if (currentUser.role !== "BGH") { alert("⛔ Phân hệ dành riêng cho BGH."); goToHome(); return; }
    document.getElementById("bgh-section").classList.remove("hidden");
    switchBghTab(bghActiveTab);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openLoginModal(msg) { if(msg) document.getElementById("login-modal-msg").innerText = msg; document.getElementById("login-modal").classList.remove("hidden"); }
function closeLoginModal() { document.getElementById("login-modal").classList.add("hidden"); }
function openEvidenceModal(taskId) { document.getElementById("evidence-task-id").value = taskId; document.getElementById("evidence-modal").classList.remove("hidden"); }
function closeEvidenceModal() { document.getElementById("evidence-modal").classList.add("hidden"); }

// Các hàm tab dashboard
function switchKpiTab(tabName) {
  currentKpiTab = tabName; currentPage = 1;
  ["all", "available", "registered"].forEach(t => {
    const btn = document.getElementById("tab-" + t);
    if (btn) btn.className = (t === tabName) ? "px-3.5 py-1.5 rounded-lg bg-white text-indigo-600 shadow-sm font-bold" : "px-3.5 py-1.5 rounded-lg text-slate-600";
  });
  renderTeacherDashboard();
}

function renderTeacherDashboard() {
  const myRegs = appData.registrations.filter(r => r.teacherCode === currentUser.code);
  const totalScore = myRegs.reduce((sum, r) => sum + (r.finalScore ? Number(r.finalScore) : 0), 0);

  document.getElementById("stat-tasks-count").innerText = myRegs.length;
  document.getElementById("stat-total-score").innerText = totalScore;

  const myTableBody = document.getElementById("my-tasks-table");
  myTableBody.innerHTML = "";
  if (myRegs.length === 0) {
    myTableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Bạn chưa đăng ký nhiệm vụ nào.</td></tr>`;
  } else {
    myRegs.forEach(r => {
      const task = appData.tasks.find(t => t.id === r.taskId) || { title: r.taskId };
      const isDone = (r.finalScore !== null && r.finalScore !== "");
      let statusHtml = isDone ? `<span class="bg-emerald-100 text-emerald-700 px-2 rounded text-xs">Đã nghiệm thu</span>` : `<span class="bg-blue-50 text-blue-700 px-2 rounded text-xs">Đang thực hiện</span>`;
      let btn = isDone ? `<span class="text-xs text-emerald-600">✓ Hoàn tất</span>` : `<button onclick="openEvidenceModal('${r.taskId}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Báo cáo</button>`;

      myTableBody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold text-indigo-600">${r.taskId}</td><td class="py-2 px-4">${task.title}</td><td class="py-2 px-4 text-center">${r.baseScore}</td><td class="py-2 px-4 text-center">${statusHtml}</td><td class="py-2 px-4 text-center">${r.evidence ? `<a href="${r.evidence}" target="_blank" class="text-blue-600">Link</a>` : 'Chưa'}</td><td class="py-2 px-4 text-center text-indigo-600 font-bold">${r.finalScore || '-'}</td><td class="py-2 px-4 text-center">${btn}</td></tr>`;
    });
  }

  const tbody = document.getElementById("available-tasks-table");
  tbody.innerHTML = "";
  appData.tasks.forEach(task => {
    const isReg = myRegs.some(r => r.taskId === task.id);
    let btn = isReg ? `<span class="text-emerald-600 text-xs">Đã đăng ký</span>` : `<button onclick="registerKPI('${task.id}')" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Đăng ký</button>`;
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold">${task.id}</td><td class="py-2 px-4"><b>${task.title}</b></td><td class="py-2 px-4 text-center text-indigo-600 font-bold">${task.score}</td><td class="py-2 px-4 text-center">${task.deadline}</td><td class="py-2 px-4 text-center">${task.quota}</td><td class="py-2 px-4 text-center">${task.status}</td><td class="py-2 px-4 text-center">${btn}</td></tr>`;
  });
}

async function registerKPI(taskId) {
  const task = appData.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    const res = await fetch(SCRIPT_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "registerKPI", email: currentUser.email, maGV: currentUser.code, tenGV: currentUser.name, maViec: task.id, dinhMuc: task.score })
    });
    const json = await res.json();
    if (json.success) {
      alert("Đăng ký thành công!");
      fetchRemoteDataViaJsonp();
    } else { alert("Lỗi: " + json.error); }
  } catch (err) { alert("Lỗi kết nối server!"); }
}

function switchBghTab(tab) {
  bghActiveTab = tab;
  ["grading", "assign", "stats"].forEach(t => {
    const btn = document.getElementById(`bgh-tab-${t}-btn`);
    const content = document.getElementById(`bgh-tab-content-${t}`);
    if(btn) btn.className = (t === tab) ? "px-5 py-3 border-b-2 border-indigo-600 text-indigo-600 font-bold" : "px-5 py-3 border-b-2 border-transparent text-slate-500";
    if(content) content.classList.toggle("hidden", t !== tab);
  });
  if (tab === "grading") renderBGHGradingTable();
  if (tab === "assign") renderBghAssignTable();
}

function renderBGHGradingTable() {
  const tbody = document.getElementById("bgh-grading-table");
  tbody.innerHTML = "";
  appData.registrations.forEach((r, idx) => {
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold text-indigo-600">${r.taskId}</td><td class="py-2 px-4"><b>${r.teacherName}</b></td><td class="py-2 px-4 text-center">${r.baseScore}</td><td class="py-2 px-4 text-center">${r.evidence ? `<a href="${r.evidence}" target="_blank" class="text-indigo-600">Link</a>` : 'Không'}</td><td class="py-2 px-4 text-center">${r.finalScore ? 'Đã xong' : 'Chờ chấm'}</td><td class="py-2 px-4 text-center"><input type="number" id="bgh-score-${idx}" value="${r.finalScore||''}" class="w-16 border text-center rounded py-1"></td><td class="py-2 px-4 text-center"><button onclick="saveBghScore(${idx})" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Lưu</button></td></tr>`;
  });
}

async function saveBghScore(idx) {
  const reg = appData.registrations[idx];
  const val = document.getElementById(`bgh-score-${idx}`).value;
  if (!val) return;
  try {
    const res = await fetch(SCRIPT_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "gradeTask", email: currentUser.email, maViec: reg.taskId, maGV: reg.teacherCode, score: Number(val) })
    });
    const json = await res.json();
    if (json.success) {
      alert("Đã lưu điểm!");
      fetchRemoteDataViaJsonp();
    } else { alert("Lỗi: " + json.error); }
  } catch (e) { alert("Lỗi kết nối!"); }
}

function renderBghAssignTable() {
  const tbody = document.getElementById("bgh-assign-table");
  tbody.innerHTML = "";
  appData.staff.forEach((gv, idx) => {
    const taskOptions = appData.tasks.map(t => `<option value="${t.id}">[${t.id}] ${t.title}</option>`).join("");
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4">${idx+1}</td><td class="py-2 px-4">${gv.code}</td><td class="py-2 px-4 font-bold">${gv.name}</td><td class="py-2 px-4">${gv.subject||'Chung'}</td><td class="py-2 px-4"><select id="assign-${gv.code}" class="border rounded px-2 py-1">${taskOptions}</select></td><td class="py-2 px-4 text-center"><button onclick="assignTaskToTeacher('${gv.code}','${gv.name}')" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Giao</button></td></tr>`;
  });
}

async function assignTaskToTeacher(gvCode, gvName) {
  const taskId = document.getElementById(`assign-${gvCode}`).value;
  const task = appData.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    const res = await fetch(SCRIPT_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "registerTask", email: currentUser.email, maViec: taskId, maGV: gvCode, tenGV: gvName, dinhMuc: task.score })
    });
    const json = await res.json();
    if (json.success) {
      alert("Giao việc thành công!");
      fetchRemoteDataViaJsonp();
    } else { alert("Lỗi: " + json.error); }
  } catch (e) { alert("Lỗi kết nối!"); }
}
