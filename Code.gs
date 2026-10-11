// =========================================================
// CẤU HÌNH ID TRANG TÍNH GOOGLE SHEET
// =========================================================
const SPREADSHEET_ID ='1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';

// =========================================================
// HÀM HỖ TRỢ: QUÉT ĐỘNG DANH SÁCH EMAIL BGH TỪ SHEET 'Nhân sự'
// =========================================================
function getBghEmails(ss) {
  const sheetNS = ss.getSheetByName('Nhân sự');
  let bghList = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 0; i < rawNS.length; i++) {
      const row = rawNS[i];
      const rowStr = row.join(' ').toUpperCase();
      // Nếu dòng chứa vai trò BGH hoặc Hiệu trưởng
      if (rowStr.includes('BGH') || rowStr.includes('HIỆU TRƯỞNG')) {
        for (let j = 0; j < row.length; j++) {
          const val = String(row[j] || '').trim();
          if (val.includes('@')) {
            bghList.push(val.toLowerCase());
          }
        }
      }
    }
  }
  console.log(bghList);
  if (bghList.length === 0) {
    bghList = [];
  }
  return [...new Set(bghList)];
}

// =========================================================
// 1. XỬ LÝ ĐỌC & GHI DỮ LIỆU QUA GET (JSONP CHỐNG LỖI CORS)
// =========================================================
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || 'getInitialData';
  const callback = params.callback;

  let result;
  try {
    if (action === 'getInitialData' || action === 'getData') {
      result = getInitialData();
    } else if (action === 'gradeKPI' || action === 'gradeTask') {
      result = gradeTask(params.teacherCode || params.maGV, params.taskId || params.maViec, params.finalScore || params.score);
    } else if (action === 'registerKPI' || action === 'registerTask') {
      result = registerTask(params.teacherCode || params.maGV, params.taskId || params.maViec, params.teacherName || params.tenGV, params.score || params.dinhMuc);
    } else if (action === 'submitProof' || action === 'submitEvidence') {
      result = submitProof(params.teacherCode || params.maGV, params.taskId || params.maViec, params.evidence || params.url);
    } else if (action === 'addNewTask' || action === 'createTask') {
      result = addNewTask(params.taskId || params.maViec, params.title || params.tenViec, params.desc || params.moTa, params.score || params.dinhMuc, params.deadline || params.hanChot, params.quota || params.chiTieu);
    } else {
      result = { success: false, error: 'Hành động không hợp lệ: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }

  const jsonStr = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + jsonStr + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}

// =========================================================
// 2. XỬ LÝ GHI DỮ LIỆU QUA POST (DỰ PHÒNG CHUẨN REST API)
// =========================================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    const action = data.action;
    let result = { success: false, error: 'Hành động không hợp lệ: ' + action };

    if (action === 'getInitialData' || action === 'getData') {
      result = getInitialData();
    } else if (action === 'submitEvidence' || action === 'submitProof') {
      result = submitProof(data.teacherCode || data.maGV, data.taskId || data.maViec, data.evidence || data.url);
    } else if (action === 'gradeKPI' || action === 'gradeTask') {
      result = gradeTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.finalScore || data.score);
    } else if (action === 'registerKPI' || action === 'registerTask') {
      result = registerTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.teacherName || data.tenGV, data.score || data.dinhMuc);
    } else if (action === 'createTask' || action === 'addNewTask') {
      result = addNewTask(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score || data.dinhMuc, data.deadline || data.hanChot, data.quota || data.chiTieu);
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// 3. CÁC HÀM XỬ LÝ DỮ LIỆU THỰC TẾ TRONG SHEET
// =========================================================
function getInitialData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. Kho KPI (Tự động bỏ qua các dòng tiêu đề bảng)
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const tasks = [];
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 0; i < rawKho.length; i++) {
      const id = String(rawKho[i][0] || '').trim();
      if (!id || id.toUpperCase().includes('BẢNG') || id.toUpperCase().includes('MÃ VIỆC')) continue;

      let dl = '';
      if (rawKho[i][4]) {
        try {
          dl = rawKho[i][4] instanceof Date
            ? Utilities.formatDate(rawKho[i][4], "GMT+7", "dd/MM/yyyy")
            : String(rawKho[i][4]).trim();
        } catch(e) { dl = String(rawKho[i][4]).trim(); }
      }

      tasks.push({
        id: id,
        title: String(rawKho[i][1] || '').trim(),
        desc: String(rawKho[i][2] || '').trim(),
        score: Number(rawKho[i][3]) || 0,
        deadline: dl,
        quota: Number(rawKho[i][5]) || 0,
        status: String(rawKho[i][6] || 'Còn việc').trim()
      });
    }
  }

  // 2. Data phân công
  const sheetData = ss.getSheetByName('data');
  const registrations = [];
  if (sheetData) {
    const rawData = sheetData.getDataRange().getValues();
    for (let i = 0; i < rawData.length; i++) {
      const taskId = String(rawData[i][0] || '').trim();
      const teacherCode = String(rawData[i][1] || '').trim();
      if (!taskId || taskId.toUpperCase().includes('MÃ') || !teacherCode || teacherCode.toUpperCase().includes('MÃ')) continue;

      registrations.push({
        rowIndex: i + 1,
        taskId: taskId,
        teacherCode: teacherCode,
        teacherName: String(rawData[i][2] || '').trim(),
        level: String(rawData[i][3] || 'Đang thực hiện').trim(),
        baseScore: Number(rawData[i][4]) || 0,
        finalScore: (rawData[i][5] !== "" && rawData[i][5] !== null && rawData[i][5] !== undefined) ? Number(rawData[i][5]) : null,
        evidence: String(rawData[i][6] || '').trim()
      });
    }
  }

  // 3. Nhân sự
  const sheetNS = ss.getSheetByName('Nhân sự');
  const staff = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 0; i < rawNS.length; i++) {
      const code = String(rawNS[i][0] || '').trim();
      if (!code || code.toUpperCase().includes('BẢNG') || code.toUpperCase().includes('MÃ')) continue;

      staff.push({
        code: code,
        name: String(rawNS[i][1] || '').trim(),
        email: String(rawNS[i][2] || '').trim().toLowerCase(),
        subject: String(rawNS[i][3] || '').trim(),
        group: String(rawNS[i][4] || '').trim(),
        role: String(rawNS[i][5] || 'GV').trim(),
        homeroom: String(rawNS[i][6] || '').trim()
      });
    }
  }

  return {
    success: true,
    tasks: tasks,
    registrations: registrations,
    staff: staff,
    bghEmails: getBghEmails(ss)
  };
}

function gradeTask(maGV, maViec, score) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();
  for (let i = 0; i < rawData.length; i++) {
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

function registerTask(maGV, maViec, tenGV, dinhMuc) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const sheetNS = ss.getSheetByName('Nhân sự');

  if (!tenGV && sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 0; i < rawNS.length; i++) {
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
    for (let i = 0; i < rawKho.length; i++) {
      if (String(rawKho[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase()) {
        taskDinhMuc = Number(rawKho[i][3]) || taskDinhMuc;
        taskChiTieu = Number(rawKho[i][5]) || 0;
        taskRow = i + 1;
        break;
      }
    }
  }

  if (!sheetData) return { success: false, message: "Thiếu sheet data" };
  const rawData = sheetData.getDataRange().getValues();
  let count = 0;
  for (let i = 0; i < rawData.length; i++) {
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
  return { success: true, message: "Đã giao/đăng ký việc thành công và lưu vào sheet data!" };
}

function submitProof(maGV, maViec, url) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };
  const rawData = sheetData.getDataRange().getValues();

  for (let i = 0; i < rawData.length; i++) {
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

function addNewTask(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet Kho KPI" };

  sheetKho.appendRow([String(maViec).trim().toUpperCase(), tenViec, moTa, Number(dinhMuc) || 0, hanChot, Number(chiTieu) || 1, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}
