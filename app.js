// =======================================================
// CẤU HÌNH API & TÀI KHOẢN (THAY LINK WEB APP MỚI NHẤT VÀO ĐÂY)
// =======================================================
const SCRIPT_API_URL = "https://script.google.com/macros/s/AKfycbwo0e6Wz_zQFih0X3FhizMBNNSt8SVzf-F-sc9YSLdVPX4ra_-tSUXa2TrvMIkHA5RX/exec";
const GOOGLE_CLIENT_ID = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";\

let appData = { staff: [], tasks: [], registrations: [], bghEmails: [] };
let currentUser = null;
let currentModule = "home";

window.onload = function() {
  console.log("🚀 [DEBUG] Web khởi động...");
  if (window.google) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLoginResponse });
    google.accounts.id.renderButton(document.getElementById("google-signin-btn"), { theme: "outline", size: "large", width: 280 });
  }
  goToHome();
  fetchRemoteData();
};

async function fetchRemoteData() {
  console.log("📡 [DEBUG] Đang gọi fetch dữ liệu từ Google Sheet...");
  try {
    const res = await fetch(`${SCRIPT_API_URL}?action=getInitialData`);
    const json = await res.json();
    console.log("📥 [DEBUG] Nhận dữ liệu thành công:", json);

    if (json.success) {
      appData.tasks = json.tasks || [];
      appData.registrations = json.registrations || [];
      appData.staff = json.staff || [];
      appData.bghEmails = json.bghEmails || [];

      console.log("📋 Danh sách nhân sự đã tải:", appData.staff);
      console.log("👑 Danh sách BGH đã tải:", appData.bghEmails);
    }
    if (currentUser) renderAppView();
  } catch (err) {
    console.error("❌ [DEBUG] Lỗi fetch dữ liệu:", err);
  }
}

function parseJwt(token) {
  try { return JSON.parse(decodeURIComponent(escape(window.atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
  catch (e) { return null; }
}

function handleGoogleLoginResponse(response) {
  const payload = parseJwt(response.credential);
  if (payload) processUserSession(payload.email, payload.name, payload.picture);
}

function processUserSession(email, name, avatar) {
  const lowerEmail = email.toLowerCase().trim();
  console.log("🔍 Đang khớp email đăng nhập:", lowerEmail);

  const isBgh = appData.bghEmails.map(e => e.toLowerCase().trim()).includes(lowerEmail);
  let staffProfile = appData.staff.find(s => s.email && s.email.toLowerCase().trim() === lowerEmail);

  let role = isBgh ? "BGH" : "GV";
  let code = staffProfile ? staffProfile.code : (isBgh ? "BGH" : "GV_NEW");
  let realName = staffProfile ? staffProfile.name : name;

  if (!staffProfile) {
    console.warn(`⚠️ CẢNH BÁO: Không tìm thấy email ${lowerEmail} trong tab Nhân sự của Sheet!`);
  } else {
    console.log(`✅ Khớp thành công! Mã GV: ${code}, Tên: ${realName}, Quyền: ${role}`);
  }

  currentUser = { email: lowerEmail, name: realName, code: code, role: role, avatar: avatar };
  closeLoginModal();
  renderAppView();
}

function logout() {
  currentUser = null;
  document.getElementById("user-info-bar").classList.add("hidden");
  document.getElementById("nav-guest-box").classList.remove("hidden");
  goToHome();
}

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
  ["portal", "teacher", "bgh"].forEach(sec => {
    const el = document.getElementById(`${sec}-section`);
    if (el) el.classList.add("hidden");
  });
}

function goToHome() {
  currentModule = "home";
  hideAllSections();
  document.getElementById("portal-section").classList.remove("hidden");
}

function navigateToModule(moduleKey) {
  if (!currentUser) { openLoginModal("Vui lòng đăng nhập."); return; }
  currentModule = moduleKey;
  hideAllSections();
  if (moduleKey === "kpi_me") {
    document.getElementById("teacher-section").classList.remove("hidden");
    renderTeacherDashboard();
  }
}

function openLoginModal(msg) { if(msg) document.getElementById("login-modal-msg").innerText = msg; document.getElementById("login-modal").classList.remove("hidden"); }
function closeLoginModal() { document.getElementById("login-modal").classList.add("hidden"); }
function openEvidenceModal(taskId) { document.getElementById("evidence-task-id").value = taskId; document.getElementById("evidence-modal").classList.remove("hidden"); }
function closeEvidenceModal() { document.getElementById("evidence-modal").classList.add("hidden"); }

function renderTeacherDashboard() {
  const myRegs = appData.registrations.filter(r => r.teacherCode === currentUser.code);
  const totalScore = myRegs.reduce((sum, r) => sum + (r.finalScore ? Number(r.finalScore) : 0), 0);

  document.getElementById("stat-tasks-count").innerText = myRegs.length;
  document.getElementById("stat-total-score").innerText = totalScore;

  const myTableBody = document.getElementById("my-tasks-table");
  myTableBody.innerHTML = myRegs.length === 0 ? `<tr><td colspan="7" class="py-6 text-center text-slate-400">Bạn chưa đăng ký nhiệm vụ nào.</td></tr>` : "";
  myRegs.forEach(r => {
    const task = appData.tasks.find(t => t.id === r.taskId) || { title: r.taskId };
    myTableBody.innerHTML += `<tr class="border-b"><td class="py-2 px-4 font-bold text-indigo-600">${r.taskId}</td><td class="py-2 px-4">${task.title}</td><td class="py-2 px-4 text-center">${r.baseScore}</td><td class="py-2 px-4 text-center">Đang thực hiện</td><td class="py-2 px-4 text-center">Chưa</td><td class="py-2 px-4 text-center">${r.finalScore || '-'}</td></tr>`;
  });
}
