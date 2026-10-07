// =========================================================
// CẤU HÌNH BIẾN MÔI TRƯỜNG (ENV) BẢO MẬT TỪ SCRIPT PROPERTIES
// =========================================================
const properties = PropertiesService.getScriptProperties();

// Khai báo ID trang tính từ ENV.
// Người dùng tự cài đặt thuộc tính SHEET_DATA_ID trong phần Cài đặt dự án của Apps Script.
const SPREADSHEET_ID = properties.getProperty('1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54');

// =========================================================
// HÀM HỖ TRỢ: LẤY DANH SÁCH EMAIL BGH TỪ SHEET 'Nhân sự'
// =========================================================
// Hàm này quét qua sheet Nhân sự và lấy ra các email có Vai trò là 'BGH'
function getBghEmails(ss) {
  const sheetNS = ss.getSheetByName('Nhân sự');
  let bghList = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    // Giả sử dòng 1 là tiêu đề. Dòng 2 bắt đầu dữ liệu.
    for (let i = 1; i < rawNS.length; i++) {
      const role = String(rawNS[i][5] || '').trim().toUpperCase(); // Giả định cột 6 (index 5) là 'Vai trò'
      const email = String(rawNS[i][2] || '').trim().toLowerCase(); // Giả định cột 3 (index 2) là 'email'
      if (role === 'BGH' && email) {
        bghList.push(email);
      }
    }
  }
  return bghList;
}

// =========================================================
// 1. XỬ LÝ ĐỌC DỮ LIỆU (GET)
// =========================================================
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || 'getInitialData';
  const callback = params.callback;

  let result;
  try {
    if (!SPREADSHEET_ID) throw new Error("Chưa cấu hình SHEET_DATA_ID trong Script Properties.");

    if (action === 'getInitialData' || action === 'getData') {
      result = getInitialData();
    } else {
      result = { success: false, error: 'Hành động GET không hợp lệ: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }

  const jsonStr = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

// =========================================================
// 2. XỬ LÝ GHI DỮ LIỆU (POST) VÀ CHỐT CHẶN BẢO MẬT RBAC
// =========================================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    if (!SPREADSHEET_ID) throw new Error("Chưa cấu hình SHEET_DATA_ID trong Script Properties.");
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    const action = data.action;
    const userEmail = data.email ? String(data.email).trim().toLowerCase() : "";

    // 🔒 Lấy danh sách BGH trực tiếp từ Sheet để kiểm tra quyền
    const dynamicBghEmails = getBghEmails(ss);
    const requiresBgh = ['gradeKPI', 'gradeTask', 'createTask', 'addNewTask'];

    if (requiresBgh.includes(action)) {
      if (!userEmail || dynamicBghEmails.indexOf(userEmail) === -1) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          error: 'Lỗi bảo mật: Chỉ Ban Giám Hiệu mới có quyền thao tác!'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    let result = { success: false, error: 'Hành động không hợp lệ' };

    // Điều hướng chức năng
    if (action === 'submitEvidence' || action === 'submitProof') {
      result = submitProof(ss, data.teacherCode || data.maGV, data.taskId || data.maViec, data.evidence || data.url);
    }
    else if (action === 'gradeKPI' || action === 'gradeTask') {
      result = gradeTask(ss, data.teacherCode || data.maGV, data.taskId || data.maViec, data.finalScore || data.score);
    }
    else if (action === 'registerKPI' || action === 'registerTask') {
      result = registerTask(ss, data.teacherCode || data.maGV, data.taskId || data.maViec, data.teacherName || data.tenGV, data.score || data.dinhMuc);
    }
    else if (action === 'createTask' || action === 'addNewTask') {
      result = addNewTask(ss, data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score || data.dinhMuc, data.deadline || data.hanChot, data.quota || data.chiTieu);
    }
    else if (action === 'saveDiscipline') {
      result = { success: true, message: "Tính năng ghi nề nếp chưa được kết nối với sheet." };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// 3. CÁC HÀM XỬ LÝ LOGIC TRONG GOOGLE SHEETS
// =========================================================

function getInitialData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheetKho = ss.getSheetByName('kho KPI');
  const tasks = [];
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 1; i < rawKho.length; i++) { // Giả định dòng 1 là Header
      if (rawKho[i][0]) {
        tasks.push({
          id: String(rawKho[i][0]).trim(),
          title: String(rawKho[i][1] || '').trim(),
          desc: String(rawKho[i][2] || '').trim(),
          score: Number(rawKho[i][3]) || 0,
          deadline: rawKho[i][4] ? Utilities.formatDate(new Date(rawKho[i][4]), "GMT+7", "dd/MM/yyyy") : '',
          quota: Number(rawKho[i][5]) || 0,
          status: String(rawKho[i][6] || 'Còn việc').trim()
        });
      }
    }
  }

  const sheetData = ss.getSheetByName('data');
  const registrations = [];
  if (sheetData) {
    const rawData = sheetData.getDataRange().getValues();
    for (let i = 1; i < rawData.length; i++) {
      if (rawData[i][0] && rawData[i][1]) {
        registrations.push({
          rowIndex: i + 1,
          taskId: String(rawData[i][0]).trim(),
          teacherCode: String(rawData[i][1]).trim(),
          teacherName: String(rawData[i][2] || '').trim(),
          level: String(rawData[i][3] || 'Đang thực hiện').trim(),
          baseScore: Number(rawData[i][4]) || 0,
          finalScore: (rawData[i][5] !== "" && rawData[i][5] !== null && rawData[i][5] !== undefined) ? Number(rawData[i][5]) : null,
          evidence: String(rawData[i][6] || '').trim()
        });
      }
    }
  }

  const sheetNS = ss.getSheetByName('Nhân sự');
  const staff = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 1; i < rawNS.length; i++) { // Bắt đầu từ dòng 2 (index 1)
      if (rawNS[i][0]) {
        staff.push({
          code: String(rawNS[i][0]).trim(),
          name: String(rawNS[i][1] || '').trim(),
          email: String(rawNS[i][2] || '').trim().toLowerCase(),
          subject: String(rawNS[i][3] || '').trim(),
          group: String(rawNS[i][4] || '').trim(),
          role: String(rawNS[i][5] || 'GV').trim(),
          homeroom: String(rawNS[i][6] || '').trim()
        });
      }
    }
  }

  // Đọc danh sách email BGH từ sheet Nhân sự và trả về
  const dynamicBghEmails = getBghEmails(ss);

  return {
    success: true,
    tasks: tasks,
    registrations: registrations,
    staff: staff,
    bghEmails: dynamicBghEmails // Frontend sẽ dùng mảng này để phân quyền
  };
}

// Chú ý: Các hàm xử lý giờ nhận object `ss` (SpreadsheetApp.openById) làm tham số để tối ưu.
function gradeTask(ss, maGV, maViec, score) {
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();
  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() &&
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Đã xong");
      sheetData.getRange(row, 6).setValue(Number(score));
      SpreadsheetApp.flush();
      return { success: true, message: `Đã chấm điểm thành công cho ${maGV}!` };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ trong sheet data" };
}

function registerTask(ss, maGV, maViec, tenGV, dinhMuc) {
  const sheetData = ss.getSheetByName('data');
  const sheetKho = ss.getSheetByName('kho KPI');
  const sheetNS = ss.getSheetByName('Nhân sự');

  if (!tenGV && sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 1; i < rawNS.length; i++) {
      if (String(rawNS[i][0]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
        tenGV = rawNS[i][1];
        break;
      }
    }
  }

  let taskDinhMuc = Number(dinhMuc) || 0;
  let taskChiTieu = 0;
  let taskRow = -1;
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 1; i < rawKho.length; i++) {
      if (String(rawKho[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase()) {
        taskDinhMuc = Number(rawKho[i][3]) || taskDinhMuc;
        taskChiTieu = Number(rawKho[i][5]) || 0;
        taskRow = i + 1;
        break;
      }
    }
  }

  const rawData = sheetData.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase()) {
      count++;
      if (String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
        return { success: true, message: "Đã có trong danh sách phân công" };
      }
    }
  }

  sheetData.appendRow([String(maViec).trim().toUpperCase(), String(maGV).trim().toUpperCase(), tenGV || '', "Đang thực hiện", taskDinhMuc, "", ""]);

  if (taskChiTieu > 0 && count + 1 >= taskChiTieu && taskRow > 0 && sheetKho) {
    sheetKho.getRange(taskRow, 7).setValue('Hết việc');
  }

  SpreadsheetApp.flush();
  return { success: true, message: "Đã giao/đăng ký việc thành công!" };
}

function submitProof(ss, maGV, maViec, url) {
  const sheetData = ss.getSheetByName('data');
  if(!sheetData) return { success: false, message: "Không tìm thấy sheet data" };
  const rawData = sheetData.getDataRange().getValues();

  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() &&
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Chờ nghiệm thu");
      sheetData.getRange(row, 7).setValue(url);
      SpreadsheetApp.flush();
      return { success: true, message: "Nộp minh chứng thành công!" };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ" };
}

function addNewTask(ss, maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const sheetKho = ss.getSheetByName('kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet kho KPI" };

  sheetKho.appendRow([maViec, tenViec, moTa, Number(dinhMuc) || 0, hanChot, Number(chiTieu) || 1, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}
