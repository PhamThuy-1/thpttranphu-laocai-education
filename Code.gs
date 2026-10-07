const SPREADSHEET_ID = '1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';

// GET: Chỉ dùng để LẤY DỮ LIỆU (Read-only), tuyệt đối không ghi/sửa dữ liệu ở GET
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const action = params.action || 'getInitialData';

  let result = { success: false, error: 'Hành động không hợp lệ' };

  try {
    if (action === 'getInitialData' || action === 'getData') {
      result = getInitialData(params.email);
    } else if (action === 'verifyUser') {
      result = verifyUser(params.email);
    }
  } catch (err) {
    result = { success: false, error: err.toString() };
  }

  return responseJSON(result);
}

// POST: Dùng cho TẤT CẢ THAO TÁC THAY ĐỔI DỮ LIỆU (Write/Update)
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return responseJSON({ success: false, error: 'Hệ thống đang bận xử lý, vui lòng thử lại sau giây lát!' });
  }

  try {
    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    const action = data.action;
    const userEmail = (data.userEmail || '').toLowerCase().trim();

    // 1. Lấy và kiểm tra thông tin User trực tiếp từ Sheet "Nhân sự"
    const user = getUserByEmail(userEmail);
    if (!user) {
      return responseJSON({ success: false, error: 'Tài khoản Email này chưa được cấp phép trong hệ thống Nhân sự!' });
    }

    let result = { success: false, error: 'Hành động không được hỗ trợ' };

    // 2. PHÂN QUYỀN VÀ XỬ LÝ Ở BACKEND
    if (action === 'gradeTask') {
      if (user.role !== 'BGH') return responseJSON({ success: false, error: '⛔ Cảnh báo bảo mật: Chỉ Ban Giám Hiệu mới có quyền chấm điểm!' });
      result = gradeTask(data.maGV, data.maViec, data.score);

    } else if (action === 'addNewTask') {
      if (user.role !== 'BGH') return responseJSON({ success: false, error: '⛔ Cảnh báo bảo mật: Chỉ Ban Giám Hiệu mới có quyền tạo nhiệm vụ!' });
      result = addNewTask(data.taskId, data.title, data.desc, data.score, data.deadline, data.quota);

    } else if (action === 'assignTask') {
      if (user.role !== 'BGH') return responseJSON({ success: false, error: '⛔ Cảnh báo bảo mật: Chỉ Ban Giám Hiệu mới có quyền giao việc!' });
      result = registerTask(data.maGV, data.maViec, data.tenGV, data.score);

    } else if (action === 'approveLeave') {
      if (user.role !== 'BGH') return responseJSON({ success: false, error: '⛔ Cảnh báo bảo mật: Chỉ Ban Giám Hiệu mới có quyền duyệt xin nghỉ!' });
      result = approveLeave(data.leaveId);

    } else if (action === 'registerKPI') {
      result = registerTask(user.code, data.taskId, user.name, data.score);

    } else if (action === 'submitEvidence') {
      result = submitProof(user.code, data.taskId, data.evidence);

    } else if (action === 'addDiscipline') {
      result = addDiscipline(data.className, data.student, data.content, data.points, user.name);

    } else if (action === 'addLeave') {
      result = addLeave(user.code, user.name, data.reason, data.dates, data.plan);

    } else if (action === 'addEquipment') {
      result = addEquipment(user.code, user.name, data.item, data.period, data.date);

    } else if (action === 'returnEquipment') {
      result = returnEquipment(data.equipId);
    }

    return responseJSON(result);
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- CÁC HÀM XỬ LÝ TRUY VẤN GOOGLE SHEET ---

function getUserByEmail(email) {
  if (!email) return null;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetNS = ss.getSheetByName('Nhân sự');
  if (!sheetNS) return null;

  const rawNS = sheetNS.getDataRange().getValues();
  for (let i = 2; i < rawNS.length; i++) {
    const sheetEmail = String(rawNS[i][2] || '').trim().toLowerCase();
    if (sheetEmail === email.toLowerCase()) {
      return {
        code: String(rawNS[i][0]).trim(),
        name: String(rawNS[i][1] || '').trim(),
        email: sheetEmail,
        subject: String(rawNS[i][3] || '').trim(),
        group: String(rawNS[i][4] || '').trim(),
        role: String(rawNS[i][5] || 'GV').trim().toUpperCase(),
        homeroom: String(rawNS[i][6] || '').trim()
      };
    }
  }
  return null;
}

function verifyUser(email) {
  const user = getUserByEmail(email);
  if (user) {
    return { success: true, user: user };
  }
  return { success: false, error: 'Tài khoản chưa có trong danh sách Nhân sự.' };
}

function getInitialData(email) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. Kho KPI
  const sheetKho = ss.getSheetByName('Kho KPI');
  const tasks = [];
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 2; i < rawKho.length; i++) {
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

  // 2. Data Đăng ký
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

  // 3. Nhân sự
  const sheetNS = ss.getSheetByName('Nhân sự');
  const staff = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 2; i < rawNS.length; i++) {
      if (rawNS[i][0]) {
        staff.push({
          code: String(rawNS[i][0]).trim(),
          name: String(rawNS[i][1] || '').trim(),
          email: String(rawNS[i][2] || '').trim().toLowerCase(),
          subject: String(rawNS[i][3] || '').trim(),
          group: String(rawNS[i][4] || '').trim(),
          role: String(rawNS[i][5] || 'GV').trim().toUpperCase(),
          homeroom: String(rawNS[i][6] || '').trim()
        });
      }
    }
  }

  // 4. Nề nếp
  const sheetDisc = getOrCreateSheet(ss, 'Nề nếp', ['Ngày', 'Lớp', 'Học sinh', 'Nội dung', 'Điểm', 'Người ghi']);
  const disciplines = [];
  const rawDisc = sheetDisc.getDataRange().getValues();
  for (let i = 1; i < rawDisc.length; i++) {
    if (rawDisc[i][0]) {
      disciplines.push({
        date: String(rawDisc[i][0]),
        class: String(rawDisc[i][1]),
        student: String(rawDisc[i][2]),
        content: String(rawDisc[i][3]),
        points: Number(rawDisc[i][4]) || 0,
        recorder: String(rawDisc[i][5])
      });
    }
  }

  // 5. Xin nghỉ
  const sheetLeave = getOrCreateSheet(ss, 'Xin nghỉ', ['Mã đơn', 'Mã GV', 'Tên GV', 'Lý do', 'Thời gian', 'Kế hoạch', 'Trạng thái']);
  const leaves = [];
  const rawLeave = sheetLeave.getDataRange().getValues();
  for (let i = 1; i < rawLeave.length; i++) {
    if (rawLeave[i][0]) {
      leaves.push({
        id: String(rawLeave[i][0]),
        teacherCode: String(rawLeave[i][1]),
        teacherName: String(rawLeave[i][2]),
        reason: String(rawLeave[i][3]),
        dates: String(rawLeave[i][4]),
        plan: String(rawLeave[i][5]),
        status: String(rawLeave[i][6])
      });
    }
  }

  // 6. Mượn thiết bị
  const sheetEquip = getOrCreateSheet(ss, 'Mượn thiết bị', ['Mã mượn', 'Mã GV', 'Tên GV', 'Thiết bị', 'Tiết dạy', 'Ngày', 'Trạng thái']);
  const equipmentBorrows = [];
  const rawEquip = sheetEquip.getDataRange().getValues();
  for (let i = 1; i < rawEquip.length; i++) {
    if (rawEquip[i][0]) {
      equipmentBorrows.push({
        id: String(rawEquip[i][0]),
        teacherCode: String(rawEquip[i][1]),
        teacherName: String(rawEquip[i][2]),
        item: String(rawEquip[i][3]),
        period: String(rawEquip[i][4]),
        date: String(rawEquip[i][5]),
        status: String(rawEquip[i][6])
      });
    }
  }

  const currentUserInfo = getUserByEmail(email);

  return {
    success: true,
    user: currentUserInfo,
    tasks: tasks,
    registrations: registrations,
    staff: staff,
    disciplines: disciplines,
    leaves: leaves,
    equipmentBorrows: equipmentBorrows
  };
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function gradeTask(maGV, maViec, score) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, error: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();
  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() &&
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Đã xong");
      sheetData.getRange(row, 6).setValue(Number(score));
      SpreadsheetApp.flush();
      return { success: true, message: `Đã cập nhật điểm ${score} thành công cho ${maGV}` };
    }
  }
  return { success: false, error: "Không tìm thấy nhiệm vụ tương ứng trong hệ thống." };
}

function registerTask(maGV, maViec, tenGV, dinhMuc) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  const sheetKho = ss.getSheetByName('Kho KPI');

  let taskDinhMuc = Number(dinhMuc) || 0;
  let taskChiTieu = 0;
  let taskRow = -1;

  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 2; i < rawKho.length; i++) {
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
        return { success: false, error: "Giáo viên đã nhận nhiệm vụ này trước đó!" };
      }
    }
  }

  sheetData.appendRow([String(maViec).trim().toUpperCase(), String(maGV).trim().toUpperCase(), tenGV || '', "Đang thực hiện", taskDinhMuc, "", ""]);

  if (taskChiTieu > 0 && count + 1 >= taskChiTieu && taskRow > 0 && sheetKho) {
    sheetKho.getRange(taskRow, 7).setValue('Hết việc');
  }

  SpreadsheetApp.flush();
  return { success: true, message: "Đã phân công / đăng ký nhiệm vụ thành công!" };
}

function submitProof(maGV, maViec, url) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  const rawData = sheetData.getDataRange().getValues();

  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() &&
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Chờ nghiệm thu");
      sheetData.getRange(row, 7).setValue(url);
      SpreadsheetApp.flush();
      return { success: true, message: "Cập nhật minh chứng thành công!" };
    }
  }
  return { success: false, error: "Không tìm thấy bản ghi nhiệm vụ để nộp minh chứng." };
}

function addNewTask(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetKho = ss.getSheetByName('Kho KPI');
  sheetKho.appendRow([maViec, tenViec, moTa, Number(dinhMuc) || 0, hanChot, Number(chiTieu) || 1, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Đã tạo nhiệm vụ mới vào Kho KPI!" };
}

function addDiscipline(className, student, content, points, recorder) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, 'Nề nếp', ['Ngày', 'Lớp', 'Học sinh', 'Nội dung', 'Điểm', 'Người ghi']);
  const dateStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy");
  sheet.appendRow([dateStr, className, student, content, Number(points), recorder]);
  SpreadsheetApp.flush();
  return { success: true, message: "Đã ghi nhận nhật ký nề nếp!" };
}

function addLeave(teacherCode, teacherName, reason, dates, plan) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, 'Xin nghỉ', ['Mã đơn', 'Mã GV', 'Tên GV', 'Lý do', 'Thời gian', 'Kế hoạch', 'Trạng thái']);
  const id = "NP" + String(sheet.getLastRow()).padStart(2, '0');
  sheet.appendRow([id, teacherCode, teacherName, reason, dates, plan, "Chờ BGH duyệt"]);
  SpreadsheetApp.flush();
  return { success: true, message: "Đã nộp đơn xin nghỉ phép!" };
}

function approveLeave(leaveId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Xin nghỉ');
  if (!sheet) return { success: false, error: "Thiếu sheet Xin nghỉ" };
  const raw = sheet.getDataRange().getValues();
  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][0]).trim() === String(leaveId).trim()) {
      sheet.getRange(i + 1, 7).setValue("Đã duyệt");
      SpreadsheetApp.flush();
      return { success: true, message: "Đã duyệt đơn nghỉ phép!" };
    }
  }
  return { success: false, error: "Không tìm thấy đơn xin nghỉ." };
}

function addEquipment(teacherCode, teacherName, item, period, date) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, 'Mượn thiết bị', ['Mã mượn', 'Mã GV', 'Tên GV', 'Thiết bị', 'Tiết dạy', 'Ngày', 'Trạng thái']);
  const id = "MT" + String(sheet.getLastRow()).padStart(2, '0');
  sheet.appendRow([id, teacherCode, teacherName, item, period, date, "Đang mượn"]);
  SpreadsheetApp.flush();
  return { success: true, message: "Đã đăng ký mượn thiết bị!" };
}

function returnEquipment(equipId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Mượn thiết bị');
  if (!sheet) return { success: false, error: "Thiếu sheet Mượn thiết bị" };
  const raw = sheet.getDataRange().getValues();
  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][0]).trim() === String(equipId).trim()) {
      sheet.getRange(i + 1, 7).setValue("Đã trả");
      SpreadsheetApp.flush();
      return { success: true, message: "Đã xác nhận trả thiết bị!" };
    }
  }
  return { success: false, error: "Không tìm thấy mã mượn thiết bị." };
}
