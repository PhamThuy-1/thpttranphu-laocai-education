// =======================================================
// CẤU HÌNH API & TÀI KHOẢN
// =======================================================
// ĐIỀN ĐƯỜNG LINK GOOGLE SCRIPT CỦA CÔ VÀO ĐÂY:
const SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbxKqmkVAW2iGr96AF8-icSKKNdOGLEXqwAEAiANm1VYD21ARQk0KzHnbY-_BGRTwtsB0A/exec";
const GOOGLE_CLIENT_ID = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";

// Khởi tạo trạng thái rỗng hoàn toàn, chỉ đợi Google Script cấp dữ liệu
let appData = { staff: [], tasks: [], registrations: [], disciplines: [], leaves: [], equipmentBorrows: [], bghEmails: [] };

let currentUser = null;
let currentModule = "home";
let bghActiveTab = "grading";
let bghPage = 1, bghItemsPerPage = 10;
let currentKpiTab = "all", currentPage = 1, itemsPerPage = 10;

// =======================================================
// 1. KHỞI TẠO VÀ XÁC THỰC
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
  fetchRemoteData(true); // Lần đầu vào web luôn bắt buộc lấy từ Google Script
};

function parseJwt(token) {
  try { return JSON.parse(decodeURIComponent(escape(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
  catch (e) { return null; }
}

function handleGoogleLoginResponse(response) {
  const payload = parseJwt(response.credential);
  if (payload) processUserSession(payload.email, payload.name, payload.picture);
}

function processUserSession(email, name, avatar) {
  const lowerEmail = email.toLowerCase();
  let role = "GV";
  let staffProfile = appData.staff.find(s => s.email === lowerEmail);

  // ĐỌC QUYỀN TỪ appData THAY VÌ HẰNG SỐ CỨNG
  if (appData.bghEmails && appData.bghEmails.includes(lowerEmail)) {
    role = "BGH";
  }
  else if (!staffProfile) {
    staffProfile = { code: "GV_NEW", name: name, email: lowerEmail, subject: "Chung" };
    appData.staff.push(staffProfile);
  }

  currentUser = { email: lowerEmail, name: staffProfile ? staffProfile.name : name, code: staffProfile ? staffProfile.code : "BGH", role: role, avatar: avatar };
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
// 2. LẤY DỮ LIỆU TỪ GOOGLE SCRIPT (CHỈ ĐỌC)
// =======================================================
async function fetchRemoteData(forceReload = false) {
  // Nếu có dữ liệu trong Cache và không bị ép tải lại -> Lấy tạm để hiện nhanh giao diện
  const cachedData = sessionStorage.getItem("THPT_TranPhu_Data");
  if (cachedData && !forceReload) {
    appData = JSON.parse(cachedData);
    if (currentUser) renderAppView();
    return;
  }

  // Tải dữ liệu thật từ Google Apps Script
  try {
    const res = await fetch(`${SCRIPT_API_URL}?action=getInitialData`);
    const json = await res.json();
    if (json.success) {
          if (json.tasks) appData.tasks = json.tasks;
          if (json.staff) appData.staff = json.staff;
          if (json.registrations) appData.registrations = json.registrations;

          // Nhận danh sách BGH từ Google Script trả về
          if (json.bghEmails) appData.bghEmails = json.bghEmails;

          sessionStorage.setItem("THPT_TranPhu_Data", JSON.stringify(appData));
        }

        // Cập nhật lại quyền trong trường hợp dữ liệu tải xong SAU KHI người dùng đã đăng nhập
        if (currentUser && appData.bghEmails && appData.bghEmails.includes(currentUser.email)) {
            currentUser.role = "BGH";
        }

        if (currentUser) renderAppView();
  } catch (err) {
    console.error("Lỗi lấy dữ liệu từ Google Script:", err);
  }
}

// Hàm gửi lệnh xử lý tới Google Script (Bắt buộc dùng await để chờ)
async function sendActionToServer(actionName, payload, btnElement) {
  const originalText = btnElement.innerText;
  btnElement.innerText = "⏳ Đang xử lý...";
  btnElement.disabled = true;

  try {
    const response = await fetch(SCRIPT_API_URL, {
      method: "POST",
      body: JSON.stringify({ ...payload, action: actionName, email: currentUser.email }) // Luôn đính kèm email để backend xác thực
    });

    const result = await response.json();

    if (result.success) {
      // NẾU MÁY CHỦ XÁC NHẬN THÀNH CÔNG -> Ép tải lại toàn bộ dữ liệu mới nhất
      await fetchRemoteData(true);
      alert("✅ " + (result.message || "Thao tác thành công!"));
      return true;
    } else {
      // NẾU MÁY CHỦ TỪ CHỐI -> Báo lỗi, không cập nhật giao diện
      alert("❌ Lỗi từ máy chủ: " + result.error);
      return false;
    }
  } catch (error) {
    alert("❌ Lỗi kết nối đến máy chủ Google. Vui lòng thử lại!");
    return false;
  } finally {
    btnElement.innerText = originalText;
    btnElement.disabled = false;
  }
}

// =======================================================
// 3. ĐIỀU HƯỚNG GIAO DIỆN (CHỈ HIỂN THỊ, KHÔNG XỬ LÝ LOGIC)
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

  const bghCard = document.getElementById("card-kpi-bgh");
  if (bghCard) bghCard.classList.toggle("hidden", currentUser.role !== "BGH");

  if (currentModule !== "home") navigateToModule(currentModule);
  else goToHome();
}

function hideAllSections() { ["portal", "teacher", "bgh", "students", "leave", "equipment"].forEach(sec => { const el = document.getElementById(`${sec}-section`); if(el) el.classList.add("hidden"); }); }

function goToHome() { currentModule = "home"; hideAllSections(); document.getElementById("portal-section").classList.remove("hidden"); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function navigateToModule(moduleKey) {
  if (!currentUser) { openLoginModal("Vui lòng đăng nhập để truy cập."); return; }
  currentModule = moduleKey; hideAllSections();

  if (moduleKey === "kpi_me") { document.getElementById("teacher-section").classList.remove("hidden"); renderTeacherDashboard(); }
  else if (moduleKey === "kpi_bgh") { if (currentUser.role !== "BGH") { alert("⛔ Phân hệ dành riêng cho BGH."); goToHome(); return; } document.getElementById("bgh-section").classList.remove("hidden"); switchBghTab(bghActiveTab); }
  else if (moduleKey === "students") { document.getElementById("students-section").classList.remove("hidden"); renderStudentsSection(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =======================================================
// 4. QUẢN LÝ MODALS
// =======================================================
function openLoginModal(msg) { if(msg) document.getElementById("login-modal-msg").innerText = msg; document.getElementById("login-modal").classList.remove("hidden"); }
function closeLoginModal() { document.getElementById("login-modal").classList.add("hidden"); }
function openEvidenceModal(taskId) { document.getElementById("evidence-task-id").value = taskId; document.getElementById("evidence-modal").classList.remove("hidden"); }
function closeEvidenceModal() { document.getElementById("evidence-modal").classList.add("hidden"); }
function openCreateTaskModal() { document.getElementById("task-modal").classList.remove("hidden"); }
function closeCreateTaskModal() { document.getElementById("task-modal").classList.add("hidden"); }
function openAddDisciplineModal() { document.getElementById("discipline-modal").classList.remove("hidden"); }
function closeAddDisciplineModal() { document.getElementById("discipline-modal").classList.add("hidden"); }

// =======================================================
// 5. CÁC HÀM XỬ LÝ (GỌI ĐẾN MÁY CHỦ XÁC THỰC)
// =======================================================

// A. GIÁO VIÊN NỘP MINH CHỨNG
async function submitEvidence(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const taskId = document.getElementById("evidence-task-id").value;
  const link = document.getElementById("evidence-link-input").value.trim();

  // Gọi Máy chủ
  const isSuccess = await sendActionToServer("submitEvidence", { maGV: currentUser.code, maViec: taskId, url: link }, btn);
  if (isSuccess) {
    closeEvidenceModal();
    renderTeacherDashboard(); // Vẽ lại giao diện từ data mới tải về
  }
}

// B. BGH CHẤM ĐIỂM KPI
async function saveBghScore(idx, btnElement) {
  const reg = appData.registrations[idx];
  const val = document.getElementById(`bgh-score-${idx}`).value;
  if (!val) return alert("Vui lòng nhập điểm!");

  // Gọi Máy chủ xác thực (Phải là email BGH thì Script mới cho qua)
  const isSuccess = await sendActionToServer("gradeTask", { maViec: reg.taskId, maGV: reg.teacherCode, score: Number(val) }, btnElement);
  if (isSuccess) {
    renderBGHGradingTable();
  }
}

// C. BGH GIAO VIỆC
async function assignTaskToTeacher(gvCode, gvName, btnElement) {
  const taskId = document.getElementById(`assign-${gvCode}`).value;
  if (!taskId) return alert("Vui lòng chọn việc!");
  const task = appData.tasks.find(t => t.id === taskId);

  const isSuccess = await sendActionToServer("registerTask", { maViec: taskId, maGV: gvCode, tenGV: gvName, dinhMuc: task.score }, btnElement);
  if (isSuccess) {
    renderBghAssignTable();
  }
}

// D. BGH TẠO VIỆC MỚI
async function handleCreateTask(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const payload = {
    maViec: document.getElementById("modal-task-id").value,
    tenViec: document.getElementById("modal-task-title").value,
    moTa: document.getElementById("modal-task-desc").value,
    dinhMuc: Number(document.getElementById("modal-task-score").value),
    hanChot: document.getElementById("modal-task-deadline").value,
    chiTieu: Number(document.getElementById("modal-task-quota").value)
  };

  const isSuccess = await sendActionToServer("createTask", payload, btn);
  if (isSuccess) {
    closeCreateTaskModal();
    if (bghActiveTab === "assign") renderBghAssignTable();
  }
}

// E. GIÁO VIÊN ĐĂNG KÝ VIỆC TỪ KHO
async function registerKPI(taskId, btnElement) {
  const task = appData.tasks.find(t => t.id === taskId);
  if (!task) return;

  const isSuccess = await sendActionToServer("registerKPI", { maGV: currentUser.code, tenGV: currentUser.name, maViec: task.id, dinhMuc: task.score }, btnElement);
  if (isSuccess) {
    renderTeacherDashboard();
  }
}

// F. GHI NHẬN NỀ NẾP HỌC SINH (Sẵn sàng cho sau này)
async function handleSaveDiscipline(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const newData = {
    date: new Date().toLocaleDateString('vi-VN'),
    class: document.getElementById("modal-disc-class").value,
    student: document.getElementById("modal-disc-student").value.trim(),
    content: document.getElementById("modal-disc-content").value.trim(),
    points: Number(document.getElementById("modal-disc-points").value),
    recorder: currentUser.name
  };

  const isSuccess = await sendActionToServer("saveDiscipline", { data: newData }, btn);
  if (isSuccess) {
    closeAddDisciplineModal();
    renderStudentsSection();
  }
}

// =======================================================
// 6. CÁC HÀM VẼ GIAO DIỆN (CHỈ ĐỌC TỪ appData MÁY CHỦ TRẢ VỀ)
// =======================================================

function switchKpiTab(tabName) { currentKpiTab = tabName; currentPage = 1; renderTeacherDashboard(); }
function changePageSize(size) { itemsPerPage = Number(size); currentPage = 1; renderTeacherDashboard(); }
function prevPage() { if (currentPage > 1) { currentPage--; renderTeacherDashboard(); } }
function nextPage() { currentPage++; renderTeacherDashboard(); }

function renderTeacherDashboard() {
  const myRegs = appData.registrations.filter(r => r.teacherCode === currentUser.code);
  const totalScore = myRegs.reduce((sum, r) => sum + (r.finalScore ? Number(r.finalScore) : 0), 0);

  document.getElementById("stat-tasks-count").innerText = myRegs.length;
  document.getElementById("stat-total-score").innerText = totalScore;

  // Render việc của tôi
  const myTableBody = document.getElementById("my-tasks-table");
  myTableBody.innerHTML = "";
  if (myRegs.length === 0) {
    myTableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">Chưa đăng ký nhiệm vụ nào.</td></tr>`;
  } else {
    myRegs.forEach(r => {
      const task = appData.tasks.find(t => t.id === r.taskId) || { title: r.taskId };
      const isDone = (r.finalScore !== null && r.finalScore !== "");
      let statusHtml = isDone ? `<span class="bg-emerald-100 text-emerald-700 px-2 rounded text-xs">Đã nghiệm thu</span>` : `<span class="bg-blue-50 text-blue-700 px-2 rounded text-xs">Đang thực hiện</span>`;
      let btn = isDone ? `<span class="text-xs text-emerald-600">✓ Hoàn tất</span>` : `<button onclick="openEvidenceModal('${r.taskId}')" class="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Báo cáo</button>`;

      myTableBody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold text-indigo-600">${r.taskId}</td><td class="py-2 px-4">${task.title}</td><td class="py-2 px-4 text-center">${r.baseScore}</td><td class="py-2 px-4 text-center">${statusHtml}</td><td class="py-2 px-4 text-center">${r.evidence ? `<a href="${r.evidence}" target="_blank" class="text-blue-600">Có Link</a>` : 'Chưa'}</td><td class="py-2 px-4 text-center text-indigo-600 font-bold">${r.finalScore || '-'}</td><td class="py-2 px-4 text-center">${btn}</td></tr>`;
    });
  }

  // Render kho việc
  const uniqueTasks = appData.tasks;
  const registeredTasks = uniqueTasks.filter(t => myRegs.some(r => r.taskId === t.id));
  const availableTasks = uniqueTasks.filter(t => t.status !== "Hết việc" && !myRegs.some(r => r.taskId === t.id));

  let filteredTasks = currentKpiTab === "available" ? availableTasks : (currentKpiTab === "registered" ? registeredTasks : uniqueTasks);
  const displayTasks = filteredTasks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const tbody = document.getElementById("available-tasks-table");
  tbody.innerHTML = "";
  displayTasks.forEach(task => {
    const isReg = myRegs.some(r => r.taskId === task.id);
    const isFull = task.status === "Hết việc";
    let btn = isReg ? `<span class="text-emerald-600 text-xs">Đã đăng ký</span>` : (isFull ? `<span class="text-slate-400 text-xs">Đã đủ</span>` : `<button onclick="registerKPI('${task.id}', this)" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Đăng ký</button>`);
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold">${task.id}</td><td class="py-2 px-4"><b>${task.title}</b></td><td class="py-2 px-4 text-center text-indigo-600 font-bold">${task.score}</td><td class="py-2 px-4 text-center">${task.deadline}</td><td class="py-2 px-4 text-center">${task.quota}</td><td class="py-2 px-4 text-center">${isFull ? 'Hết' : 'Còn'}</td><td class="py-2 px-4 text-center">${btn}</td></tr>`;
  });
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
  const displayList = appData.registrations.slice((bghPage - 1) * bghItemsPerPage, bghPage * bghItemsPerPage);

  displayList.forEach((r, idx) => {
    const t = appData.tasks.find(task => task.id === r.taskId) || {};
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold text-indigo-600">${r.taskId}</td><td class="py-2 px-4"><b>${r.teacherName}</b></td><td class="py-2 px-4 text-center">${r.baseScore}</td><td class="py-2 px-4 text-center">${t.deadline || '-'}</td><td class="py-2 px-4 text-center">${r.evidence ? `<a href="${r.evidence}" target="_blank" class="text-indigo-600">Link</a>` : 'Không'}</td><td class="py-2 px-4 text-center">${r.finalScore ? 'Đã xong' : 'Chờ chấm'}</td><td class="py-2 px-4 text-center"><input type="number" id="bgh-score-${idx}" value="${r.finalScore||''}" class="w-16 border text-center rounded py-1"></td><td class="py-2 px-4 text-center"><button onclick="saveBghScore(${idx}, this)" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Lưu điểm</button></td></tr>`;
  });
}

function renderBghAssignTable() {
  const tbody = document.getElementById("bgh-assign-table");
  tbody.innerHTML = "";
  const eligibleTasks = appData.tasks.filter(t => t.status !== "Hết việc");

  appData.staff.forEach((gv, idx) => {
    const taskOptions = eligibleTasks.map(t => `<option value="${t.id}">[${t.id}] ${t.title}</option>`).join("");
    tbody.innerHTML += `<tr class="border-b"><td class="py-2 px-4">${idx+1}</td><td class="py-2 px-4">${gv.code}</td><td class="py-2 px-4 font-bold">${gv.name}</td><td class="py-2 px-4">${gv.subject||'Chung'}</td><td class="py-2 px-4 text-center">-</td><td class="py-2 px-4 text-center text-indigo-600 font-bold">-</td><td class="py-2 px-4"><select id="assign-${gv.code}" class="border rounded px-2 py-1">${taskOptions}</select></td><td class="py-2 px-4 text-center"><button onclick="assignTaskToTeacher('${gv.code}','${gv.name}', this)" class="bg-indigo-600 text-white text-xs px-2 py-1 rounded">Giao</button></td></tr>`;
  });
}

function renderStudentsSection() {
  const tbody = document.getElementById("student-discipline-table");
  if(tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-500">Dữ liệu nề nếp sẽ được tải ở đây...</td></tr>`;
}
