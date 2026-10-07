// =======================================================
// CẤU HÌNH API & TÀI KHOẢN (ĐIỀN LINK WEB APP THẬT CỦA CÔ VÀO ĐÂY)
// =======================================================

const SCRIPT_API_URL = "https://script.google.com/macros/u/1/s/AKfycbxKqmkVAW2iGr96AF8-icSKKNdOGLEXqwAEAiANm1VYD21ARQk0KzHnbY-_BGRTwtsB0A/exec";
const GOOGLE_CLIENT_ID = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";


// State lưu trữ dữ liệu đồng bộ từ Sheet
let appData = {
  staff: [], tasks: [], registrations: [], bghEmails: []
};

let currentUser = null;
let currentModule = "home";
let bghActiveTab = "grading";
let bghPage = 1, bghItemsPerPage = 10;
let currentKpiTab = "all", currentPage = 1, itemsPerPage = 10;

// =======================================================
// KHỞI TẠO ỨNG DỤNG
// =======================================================
window.onload = function() {
  const now = new Date();
  const badge = document.getElementById("current-date-badge");
  if (badge) badge.innerText = `📅 Ngày ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  if (window.google) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLoginResponse });
    google.accounts.id.renderButton(document.getElementById("google-signin-btn"), { theme: "outline", size: "large", width: 280, text: "signin_with" });
  }
  goToHome();
  fetchRemoteData(); // Gọi lấy dữ liệu thật từ Google Sheet
};

// =======================================================
// ĐĂNG NHẬP GOOGLE & XÁC THỰC PHÂN QUYỀN
// =======================================================
function parseJwt(token) {
  try {
    return JSON.parse(decodeURIComponent(escape(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
  } catch (e) { return null; }
}

function handleGoogleLoginResponse(response) {
  const payload = parseJwt(response.credential);
  if (payload) processUserSession(payload.email, payload.name, payload.picture);
}

function processUserSession(email, name, avatar) {
  const lowerEmail = email.toLowerCase();

  // 1. Dò xem email này có nằm trong danh sách BGH lấy từ Sheet hay không
  const isBgh = appData.bghEmails && appData.bghEmails.includes(lowerEmail);

  // 2. Dò xem email này có nằm trong bảng 'KPI cố định / Nhân sự' của trường không
  let staffProfile = appData.staff.find(s => s.email === lowerEmail);

  let role = isBgh ? "BGH" : "GV";

  if (!staffProfile) {
    // Nếu giáo viên chưa có trong bảng nhân sự, tạo profile tạm để tránh sập web
    staffProfile = { code: isBgh ? "BGH" : "GV_NEW", name: name, email: lowerEmail, subject: "Chung" };
  }

  currentUser = {
    email: lowerEmail,
    name: staffProfile.name || name,
    code: staffProfile.code,
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
// LẤY DỮ LIỆU TỪ GOOGLE SCRIPT
// =======================================================
async function fetchRemoteData() {
  if (SCRIPT_API_URL.includes("AKfycb...")) {
    console.warn("Chưa cấu hình đúng link SCRIPT_API_URL!");
    return;
  }
  try {
    const res = await fetch(`${SCRIPT_API_URL}?action=getInitialData`);
    const json = await res.json();
    if (json.success) {
      if (json.tasks) appData.tasks = json.tasks;
      if (json.staff) appData.staff = json.staff;
      if (json.registrations) appData.registrations = json.registrations;
      if (json.bghEmails) appData.bghEmails = json.bghEmails;
    }
    if (currentUser) renderAppView();
  } catch (err) {
    console.warn("Lỗi tải dữ liệu từ Google Sheet:", err);
  }
}

// =======================================================
// ĐIỀU HƯỚNG & HIỂN THỊ GIAO DIỆN
// =======================================================
function renderAppView() {
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

  // Ẩn/Hiện thẻ BGH ngoài trang chủ dựa vào quyền lấy từ Sheet
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
  } else if (moduleKey === "students") {
    document.getElementById("students-section").classList.remove("hidden");
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Modal controls
function openLoginModal(msg) { if(msg) document.getElementById("login-modal-msg").innerText = msg; document.getElementById("login-modal").classList.remove("hidden"); }
function closeLoginModal() { document.getElementById("login-modal").classList.add("hidden"); }
function openEvidenceModal(taskId) { document.getElementById("evidence-task-id").value = taskId; document.getElementById("evidence-modal").classList.remove("hidden"); }
function closeEvidenceModal() { document.getElementById("evidence-modal").classList.add("hidden"); }
function openCreateTaskModal() { document.getElementById("task-modal").classList.remove("hidden"); }
function closeCreateTaskModal() { document.getElementById("task-modal").classList.add("hidden"); }

// =======================================================
// RENDER DỮ LIỆU LÊN GIAO DIỆN
// =======================================================
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

  // Kho việc
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
      fetchRemoteData(); // Tải lại dữ liệu mới nhất từ Sheet
    } else {
      alert("Lỗi: " + json.error);
    }
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
      fetchRemoteData();
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
      fetchRemoteData();
    } else { alert("Lỗi: " + json.error); }
  } catch (e) { alert("Lỗi kết nối!"); }
}
// Bổ sung các hàm điều hướng tab và mở modal còn thiếu vào app.js:
function switchKpiTab(tabName) {
  currentKpiTab = tabName;
  currentPage = 1;
  ["all", "available", "registered"].forEach(t => {
    const btn = document.getElementById("tab-" + t);
    if (btn) {
      btn.className = (t === tabName) ? "px-3.5 py-1.5 rounded-lg bg-white text-indigo-600 shadow-sm font-bold" : "px-3.5 py-1.5 rounded-lg text-slate-600";
    }
  });
  renderTeacherDashboard();
}

function changePageSize(size) {
  itemsPerPage = Number(size);
  currentPage = 1;
  renderTeacherDashboard();
}

function prevPage() {
  if (currentPage > 1) { currentPage--; renderTeacherDashboard(); }
}

function nextPage() {
  currentPage++;
  renderTeacherDashboard();
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

function changeBghPageSize(val) { bghItemsPerPage = Number(val); bghPage = 1; renderBGHGradingTable(); }
function prevBghPage() { if (bghPage > 1) { bghPage--; renderBGHGradingTable(); } }
function nextBghPage() { bghPage++; renderBGHGradingTable(); }

// Các hàm mở/đóng modal phụ trợ
function openAddDisciplineModal() { const el = document.getElementById("discipline-modal"); if(el) el.classList.remove("hidden"); }
function closeAddDisciplineModal() { const el = document.getElementById("discipline-modal"); if(el) el.classList.add("hidden"); }
function openLeaveModal() { const el = document.getElementById("leave-modal"); if(el) el.classList.remove("hidden"); }
function closeLeaveModal() { const el = document.getElementById("leave-modal"); if(el) el.classList.add("hidden"); }
function openEquipmentModal() { const el = document.getElementById("equipment-modal"); if(el) el.classList.remove("hidden"); }
function closeEquipmentModal() { const el = document.getElementById("equipment-modal"); if(el) el.classList.add("hidden"); }
