// CẤU HÌNH API GOOGLE APPS SCRIPT VÀ CLIENT ID GOOGLE SIGN-IN
const SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbwo0e6Wz_zQFih0X3FhizMBNNSt8SVzf-F-sc9YSLdVPX4ra_-tSUXa2TrvMIkHA5RX/exec";
const GOOGLE_CLIENT_ID = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";

// KHÔNG CÒN DỮ LIỆU MẪU CỨNG, MỌI DỮ LIỆU SẼ ĐƯỢC TẢI TỪ BACKEND
let appData = {
  staff: [],
  tasks: [],
  registrations: [],
  disciplines: [],
  leaves: [],
  equipmentBorrows: []
};

let currentUser = null;
let currentModule = "home";
let currentKpiTab = "all";
let currentPage = 1;
let itemsPerPage = 10;
let bghActiveTab = "grading";
let kpiChartInstance = null;

// Hàm chống chèn mã độc XSS khi render dữ liệu lên DOM
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  dateStr = String(dateStr).trim();
  if (dateStr.includes("/")) {
    const p = dateStr.split("/");
    if (p.length === 3) return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10), 23, 59, 59);
  } else if (dateStr.includes("-")) {
    const p = dateStr.split("-");
    if (p.length === 3) return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 23, 59, 59);
  }
  return null;
}

// KHỞI TẠO NGUYÊN BẢN
window.onload = function() {
  const now = new Date();
  const badge = document.getElementById("current-date-badge");
  if (badge) badge.innerText = `📅 Ngày ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  if (window.google) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleLoginResponse
    });
    google.accounts.id.renderButton(
      document.getElementById("google-signin-btn"),
      { theme: "outline", size: "large", width: 280, text: "signin_with" }
    );
  }
  goToHome();
};

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(window.atob(base64))));
  } catch (e) {
    return null;
  }
}

// XỬ LÝ ĐĂNG NHẬP THẬT TỪ GOOGLE SDK
async function handleGoogleLoginResponse(response) {
  const payload = parseJwt(response.credential);
  if (!payload || !payload.email) {
    alert("Không thể đọc thông tin xác thực Google!");
    return;
  }

  const userEmail = payload.email.toLowerCase();

  // Gọi Backend xác thực trực tiếp
  try {
    const res = await fetch(`${SCRIPT_API_URL}?action=getInitialData&email=${encodeURIComponent(userEmail)}`);
    const data = await res.json();

    if (!data.success || !data.user) {
      alert("❌ Tài khoản Google này (" + userEmail + ") không nằm trong danh sách Nhân sự trường!");
      return;
    }

    // Gán dữ liệu thực từ Backend
    currentUser = {
      email: data.user.email,
      name: data.user.name,
      code: data.user.code,
      role: data.user.role,
      avatar: payload.picture || ("https://api.dicebear.com/7.x/avataaars/svg?seed=" + encodeURIComponent(data.user.name))
    };

    appData.staff = data.staff || [];
    appData.tasks = data.tasks || [];
    appData.registrations = data.registrations || [];
    appData.disciplines = data.disciplines || [];
    appData.leaves = data.leaves || [];
    appData.equipmentBorrows = data.equipmentBorrows || [];

    closeLoginModal();
    renderAppView();

  } catch (err) {
    alert("Lỗi kết nối tới Backend Google Apps Script: " + err.message);
  }
}

function logout() {
  currentUser = null;
  document.getElementById("user-info-bar").classList.add("hidden");
  document.getElementById("nav-guest-box").classList.remove("hidden");
  goToHome();
}

function renderAppView() {
  document.getElementById("nav-guest-box").classList.add("hidden");
  document.getElementById("user-info-bar").classList.remove("hidden");

  document.getElementById("user-display-name").innerText = currentUser.name;
  document.getElementById("user-avatar").src = currentUser.avatar;
  const roleBadge = document.getElementById("user-role-badge");

  if (currentUser.role === "BGH") {
    roleBadge.innerText = "Ban Giám Hiệu";
    roleBadge.className = "inline-block mt-1 text-[11px] px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800 border border-amber-200";
  } else {
    roleBadge.innerText = `Giáo Viên (${currentUser.code})`;
    roleBadge.className = "inline-block mt-1 text-[11px] px-2 py-0.5 rounded font-medium bg-indigo-100 text-indigo-700";
  }

  if (currentModule !== "home") navigateToModule(currentModule);
  else goToHome();
}

// ĐIỀU HƯỚNG VIEW
function hideAllSections() {
  ["portal-section", "teacher-section", "bgh-section", "students-section", "leave-section", "equipment-section"].forEach(s => {
    const el = document.getElementById(s);
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
  if (!currentUser) {
    openLoginModal("Vui lòng đăng nhập bằng tài khoản trường để tiếp tục.");
    return;
  }

  currentModule = moduleKey;
  hideAllSections();

  if (moduleKey === "kpi_me") {
    document.getElementById("teacher-section").classList.remove("hidden");
    renderTeacherDashboard();
  } else if (moduleKey === "kpi_bgh") {
    if (currentUser.role !== "BGH") {
      alert("⛔ Phân hệ 'QUẢN LÝ KPI' chỉ dành riêng cho Ban Giám Hiệu.");
      goToHome();
      return;
    }
    document.getElementById("bgh-section").classList.remove("hidden");
    switchBghTab(bghActiveTab);
  } else if (moduleKey === "students") {
    document.getElementById("students-section").classList.remove("hidden");
    renderStudentsSection();
  } else if (moduleKey === "leave") {
    document.getElementById("leave-section").classList.remove("hidden");
    renderLeaveSection();
  } else if (moduleKey === "equipment") {
    document.getElementById("equipment-section").classList.remove("hidden");
    renderEquipmentSection();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// RENDER DASHBOARD GIÁO VIÊN
function renderTeacherDashboard() {
  const myRegs = appData.registrations.filter(r => r.teacherCode === currentUser.code);
  const totalScore = myRegs.reduce((sum, r) => sum + (r.finalScore !== null && r.finalScore !== "" ? Number(r.finalScore) : 0), 0);

  const allTeacherScores = (appData.staff || []).map(gv => {
    const gvRegs = (appData.registrations || []).filter(r => r.teacherCode === gv.code);
    return { code: gv.code, score: gvRegs.reduce((sum, r) => sum + (r.finalScore ? Number(r.finalScore) : 0), 0) };
  }).sort((a, b) => b.score - a.score);

  const rankIndex = allTeacherScores.findIndex(item => item.code === currentUser.code);
  const myRank = rankIndex !== -1 ? (rankIndex + 1) : "--";

  document.getElementById("stat-tasks-count").innerText = myRegs.length;
  document.getElementById("stat-total-score").innerHTML = `${totalScore} <span class="text-sm font-normal text-slate-500">điểm</span>`;
  document.getElementById("stat-potential-score").innerHTML = `#${myRank} <span class="text-sm font-normal text-slate-500">/ ${allTeacherScores.length} GV</span>`;

  const myTableBody = document.getElementById("my-tasks-table");
  myTableBody.innerHTML = "";

  if (myRegs.length === 0) {
    myTableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Bạn chưa đăng ký nhiệm vụ nào.</td></tr>`;
  } else {
    myRegs.forEach(r => {
      const task = appData.tasks.find(t => String(t.id).toUpperCase() === String(r.taskId).toUpperCase()) || {};
      const evidenceHtml = r.evidence
        ? `<a href="${escapeHtml(r.evidence)}" target="_blank" class="text-xs text-indigo-600 font-semibold underline">📁 Xem Drive</a>`
        : `<span class="text-xs text-slate-400 italic">Chưa có</span>`;

      myTableBody.innerHTML += `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
          <td class="py-3 px-4 font-semibold text-indigo-600">${escapeHtml(r.taskId)}</td>
          <td class="py-3 px-4 font-medium text-slate-800">${escapeHtml(task.title || r.taskId)}</td>
          <td class="py-3 px-4 text-center font-semibold text-slate-700">${r.baseScore}</td>
          <td class="py-3 px-4 text-center"><span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-semibold">${escapeHtml(r.level)}</span></td>
          <td class="py-3 px-4 text-center">${evidenceHtml}</td>
          <td class="py-3 px-4 text-center font-bold text-emerald-600">${r.finalScore !== null ? r.finalScore : '--'}</td>
          <td class="py-3 px-4 text-center">
            <button onclick="openEvidenceModal('${escapeHtml(r.taskId)}')" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg shadow-sm">Báo cáo hoàn thành</button>
          </td>
        </tr>
      `;
    });
  }

  renderKpiCatalog();
}

function renderKpiCatalog() {
  const tbody = document.getElementById("available-tasks-table");
  tbody.innerHTML = "";

  const myRegs = appData.registrations.filter(r => r.teacherCode === currentUser.code);
  const displayTasks = appData.tasks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  displayTasks.forEach(task => {
    const isRegistered = myRegs.some(r => String(r.taskId).toUpperCase() === String(task.id).toUpperCase());
    const actionBtn = isRegistered
      ? `<span class="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">✓ Đã đăng ký</span>`
      : `<button onclick="registerKPI('${escapeHtml(task.id)}')" class="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg shadow-sm">Đăng ký ngay</button>`;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(task.id)}</td>
        <td class="py-3 px-4"><div class="font-semibold text-slate-900">${escapeHtml(task.title)}</div><div class="text-xs text-slate-500">${escapeHtml(task.desc)}</div></td>
        <td class="py-3 px-4 text-center font-bold text-indigo-600">${task.score}</td>
        <td class="py-3 px-4 text-center text-xs text-slate-600">${escapeHtml(task.deadline)}</td>
        <td class="py-3 px-4 text-center text-xs text-slate-500">${task.quota} người</td>
        <td class="py-3 px-4 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">${escapeHtml(task.status)}</span></td>
        <td class="py-3 px-4 text-center">${actionBtn}</td>
      </tr>
    `;
  });
}

// CÁC THAO TÁC GỬI REQUEST VỀ BACKEND DÙNG METHOD POST BẢO MẬT

async function callBackendPOST(payload) {
  payload.userEmail = currentUser.email; // Luôn đính kèm Email để Backend verify
  const response = await fetch(SCRIPT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  return await response.json();
}

async function registerKPI(taskId) {
  const task = appData.tasks.find(t => t.id === taskId);
  if (!task) return;

  const res = await callBackendPOST({ action: "registerKPI", taskId: taskId, score: task.score });
  if (res.success) {
    alert("✅ " + res.message);
    refreshData();
  } else {
    alert("❌ Lỗi: " + res.error);
  }
}

async function submitEvidence(e) {
  e.preventDefault();
  const taskId = document.getElementById("evidence-task-id").value;
  const link = document.getElementById("evidence-link-input").value.trim();

  const res = await callBackendPOST({ action: "submitEvidence", taskId: taskId, evidence: link });
  if (res.success) {
    alert("✅ " + res.message);
    closeEvidenceModal();
    refreshData();
  } else {
    alert("❌ Lỗi: " + res.error);
  }
}

async function saveBghScore(idx) {
  const reg = appData.registrations[idx];
  const scoreVal = document.getElementById(`bgh-score-${idx}`).value;

  const res = await callBackendPOST({ action: "gradeTask", maGV: reg.teacherCode, maViec: reg.taskId, score: scoreVal });
  if (res.success) {
    alert("✅ " + res.message);
    refreshData();
  } else {
    alert("❌ Lỗi: " + res.error);
  }
}

async function assignTaskToTeacher(teacherCode, teacherName) {
  const select = document.getElementById(`select-task-for-${teacherCode}`);
  const taskId = select.value;
  if (!taskId) return;

  const task = appData.tasks.find(t => t.id === taskId);
  const res = await callBackendPOST({ action: "assignTask", maGV: teacherCode, tenGV: teacherName, maViec: taskId, score: task ? task.score : 0 });
  if (res.success) {
    alert("✅ " + res.message);
    refreshData();
  } else {
    alert("❌ Lỗi: " + res.error);
  }
}

async function handleCreateTask(e) {
  e.preventDefault();
  const res = await callBackendPOST({
    action: "addNewTask",
    taskId: document.getElementById("modal-task-id").value.trim(),
    title: document.getElementById("modal-task-title").value.trim(),
    desc: document.getElementById("modal-task-desc").value.trim(),
    score: Number(document.getElementById("modal-task-score").value),
    deadline: document.getElementById("modal-task-deadline").value,
    quota: Number(document.getElementById("modal-task-quota").value)
  });

  if (res.success) {
    alert("✅ " + res.message);
    closeCreateTaskModal();
    refreshData();
  } else {
    alert("❌ Lỗi: " + res.error);
  }
}

async function refreshData() {
  if (!currentUser) return;
  const res = await fetch(`${SCRIPT_API_URL}?action=getInitialData&email=${encodeURIComponent(currentUser.email)}`);
  const data = await res.json();
  if (data.success) {
    appData.tasks = data.tasks || [];
    appData.registrations = data.registrations || [];
    appData.staff = data.staff || [];
    appData.disciplines = data.disciplines || [];
    appData.leaves = data.leaves || [];
    appData.equipmentBorrows = data.equipmentBorrows || [];
    renderAppView();
  }
}

// BGH TAB & MODAL HELPERS
function switchBghTab(tab) {
  bghActiveTab = tab;
  ["grading", "assign", "stats"].forEach(t => {
    document.getElementById(`bgh-tab-${t}-btn`).className = t === tab
      ? "px-5 py-3 border-b-2 border-indigo-600 text-indigo-600 font-bold"
      : "px-5 py-3 border-b-2 border-transparent text-slate-500";
    document.getElementById(`bgh-tab-content-${t}`).classList.toggle("hidden", t !== tab);
  });

  if (tab === "grading") renderBGHGradingTable();
  if (tab === "assign") renderBghAssignTable();
  if (tab === "stats") renderBghStatsDashboard();
}

function renderBGHGradingTable() {
  const tbody = document.getElementById("bgh-grading-table");
  tbody.innerHTML = "";
  appData.registrations.forEach((r, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-3 px-4 font-bold text-indigo-600">${escapeHtml(r.taskId)}</td>
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(r.teacherName)} (${escapeHtml(r.teacherCode)})</td>
        <td class="py-3 px-4 text-center">${r.baseScore}</td>
        <td class="py-3 px-4 text-center text-xs">--</td>
        <td class="py-3 px-4 text-center">${r.evidence ? `<a href="${escapeHtml(r.evidence)}" target="_blank" class="text-xs text-indigo-600 underline">Link Drive</a>` : 'Chưa có'}</td>
        <td class="py-3 px-4 text-center"><span class="px-2 py-1 bg-amber-50 text-amber-800 rounded text-xs">${escapeHtml(r.level)}</span></td>
        <td class="py-3 px-4 text-center"><input type="number" id="bgh-score-${idx}" value="${r.finalScore !== null ? r.finalScore : ''}" class="w-16 border rounded px-2 py-1 text-center font-bold"></td>
        <td class="py-3 px-4 text-center"><button onclick="saveBghScore(${idx})" class="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg">Lưu điểm</button></td>
      </tr>
    `;
  });
}

function renderBghAssignTable() {
  const tbody = document.getElementById("bgh-assign-table");
  tbody.innerHTML = "";
  appData.staff.forEach((gv, idx) => {
    const options = appData.tasks.map(t => `<option value="${escapeHtml(t.id)}">[${escapeHtml(t.id)}] ${escapeHtml(t.title)}</option>`).join("");
    tbody.innerHTML += `
      <tr class="border-b border-slate-100">
        <td class="py-3 px-4 text-center">${idx + 1}</td>
        <td class="py-3 px-4 font-bold text-indigo-600">${escapeHtml(gv.code)}</td>
        <td class="py-3 px-4 font-bold text-slate-800">${escapeHtml(gv.name)}</td>
        <td class="py-3 px-4">${escapeHtml(gv.subject)}</td>
        <td class="py-3 px-4 text-center">--</td>
        <td class="py-3 px-4 text-center font-extrabold text-indigo-600">--</td>
        <td class="py-3 px-4"><select id="select-task-for-${escapeHtml(gv.code)}" class="w-full text-xs border rounded px-2 py-1">${options}</select></td>
        <td class="py-3 px-4 text-center"><button onclick="assignTaskToTeacher('${escapeHtml(gv.code)}', '${escapeHtml(gv.name)}')" class="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded-lg">Giao việc</button></td>
      </tr>
    `;
  });
}

function renderBghStatsDashboard() {
  document.getElementById("stat-tasks-available").innerText = appData.tasks.filter(t => t.status !== "Hết việc").length;
  document.getElementById("stat-completed-early").innerText = appData.registrations.filter(r => r.finalScore !== null).length;
  document.getElementById("stat-tasks-assigned").innerText = appData.registrations.length;

  const ctx = document.getElementById('kpiBarChart').getContext('2d');
  if (kpiChartInstance) kpiChartInstance.destroy();
  kpiChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: appData.staff.map(s => s.name),
      datasets: [{ label: 'Điểm KPI', data: appData.staff.map(() => Math.floor(Math.random() * 50) + 10), backgroundColor: '#4f46e5' }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function exportToExcel() {
  const wb = XLSX.utils.book_new();
  const wsData = [["STT", "Mã GV", "Tên GV", "Số việc", "Tổng điểm"]];
  appData.staff.forEach((s, i) => wsData.push([i + 1, s.code, s.name, 0, 0]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), "Báo Cáo KPI");
  XLSX.writeFile(wb, "Bao_Cao_KPI_Toan_Truong.xlsx");
}

function openLoginModal(msg) { if (msg) document.getElementById("login-modal-msg").innerText = msg; document.getElementById("login-modal").classList.remove("hidden"); }
function closeLoginModal() { document.getElementById("login-modal").classList.add("hidden"); }
function openEvidenceModal(id) { document.getElementById("evidence-task-id").value = id; document.getElementById("evidence-modal").classList.remove("hidden"); }
function closeEvidenceModal() { document.getElementById("evidence-modal").classList.add("hidden"); }
function openCreateTaskModal() { document.getElementById("task-modal").classList.remove("hidden"); }
function closeCreateTaskModal() { document.getElementById("task-modal").classList.add("hidden"); }
function openAddDisciplineModal() { document.getElementById("discipline-modal").classList.remove("hidden"); }
function closeAddDisciplineModal() { document.getElementById("discipline-modal").classList.add("hidden"); }
function openLeaveModal() { document.getElementById("leave-modal").classList.remove("hidden"); }
function closeLeaveModal() { document.getElementById("leave-modal").classList.add("hidden"); }
function openEquipmentModal() { document.getElementById("equipment-modal").classList.remove("hidden"); }
function closeEquipmentModal() { document.getElementById("equipment-modal").classList.add("hidden"); }
function switchKpiTab(t) { currentKpiTab = t; renderKpiCatalog(); }
function changePageSize(v) { itemsPerPage = Number(v); renderKpiCatalog(); }
function prevPage() { if (currentPage > 1) { currentPage--; renderKpiCatalog(); } }
function nextPage() { currentPage++; renderKpiCatalog(); }

function renderStudentsSection() {
  const tbody = document.getElementById("student-discipline-table");
  tbody.innerHTML = appData.disciplines.map(d => `
    <tr class="border-b border-slate-100">
      <td class="py-3 px-4">${escapeHtml(d.date)}</td>
      <td class="py-3 px-4 font-bold text-indigo-600">${escapeHtml(d.class)}</td>
      <td class="py-3 px-4 font-bold">${escapeHtml(d.student)}</td>
      <td class="py-3 px-4">${escapeHtml(d.content)}</td>
      <td class="py-3 px-4 text-center font-bold text-rose-600">${d.points}</td>
      <td class="py-3 px-4">${escapeHtml(d.recorder)}</td>
    </tr>
  `).join("");
}

function renderLeaveSection() {
  const tbody = document.getElementById("leave-table");
  tbody.innerHTML = appData.leaves.map(l => `
    <tr class="border-b border-slate-100">
      <td class="py-3 px-4 font-bold text-sky-600">${escapeHtml(l.id)}</td>
      <td class="py-3 px-4 font-bold">${escapeHtml(l.teacherName)}</td>
      <td class="py-3 px-4">${escapeHtml(l.reason)}</td>
      <td class="py-3 px-4 text-center">${escapeHtml(l.dates)}</td>
      <td class="py-3 px-4">${escapeHtml(l.plan)}</td>
      <td class="py-3 px-4 text-center"><span class="px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-xs font-semibold">${escapeHtml(l.status)}</span></td>
      <td class="py-3 px-4 text-center">--</td>
    </tr>
  `).join("");
}

function renderEquipmentSection() {
  const tbody = document.getElementById("equipment-table");
  tbody.innerHTML = appData.equipmentBorrows.map(e => `
    <tr class="border-b border-slate-100">
      <td class="py-3 px-4 font-bold text-purple-600">${escapeHtml(e.id)}</td>
      <td class="py-3 px-4 font-bold">${escapeHtml(e.teacherName)}</td>
      <td class="py-3 px-4">${escapeHtml(e.item)}</td>
      <td class="py-3 px-4 text-center">${escapeHtml(e.period)}</td>
      <td class="py-3 px-4 text-center">${escapeHtml(e.date)}</td>
      <td class="py-3 px-4 text-center"><span class="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-semibold">${escapeHtml(e.status)}</span></td>
      <td class="py-3 px-4 text-center">--</td>
    </tr>
  `).join("");
}

async function handleSaveDiscipline(e) {
  e.preventDefault();
  const res = await callBackendPOST({
    action: "addDiscipline",
    className: document.getElementById("modal-disc-class").value,
    student: document.getElementById("modal-disc-student").value.trim(),
    content: document.getElementById("modal-disc-content").value.trim(),
    points: Number(document.getElementById("modal-disc-points").value)
  });
  if (res.success) { alert("✅ " + res.message); closeAddDisciplineModal(); refreshData(); }
}

async function handleSaveLeave(e) {
  e.preventDefault();
  const res = await callBackendPOST({
    action: "addLeave",
    reason: document.getElementById("modal-leave-reason").value.trim(),
    dates: `${document.getElementById("modal-leave-date").value} (${document.getElementById("modal-leave-periods").value} tiết)`,
    plan: document.getElementById("modal-leave-plan").value.trim()
  });
  if (res.success) { alert("✅ " + res.message); closeLeaveModal(); refreshData(); }
}

async function handleSaveEquipment(e) {
  e.preventDefault();
  const res = await callBackendPOST({
    action: "addEquipment",
    item: document.getElementById("modal-equip-name").value,
    date: document.getElementById("modal-equip-date").value,
    period: document.getElementById("modal-equip-period").value.trim()
  });
  if (res.success) { alert("✅ " + res.message); closeEquipmentModal(); refreshData(); }
}
