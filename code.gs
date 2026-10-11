// =========================================================
// CẤU HÌNH ID TRANG TÍNH GOOGLE SHEET
// =========================================================
const SPREADSHEET_ID ='1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';

// =========================================================
// HÀM HỖ TRỢ: QUÉT ĐỘNG DANH SÁCH EMAIL BGH TỪ SHEET 'Nhân sự'
// =========================================================
// =========================================================
// 1. XỬ LÝ ĐỌC & GHI DỮ LIỆU QUA GET (JSONP CHỐNG LỖI CORS)
// =========================================================
function doGet(e) {
  return jsonResponse_({ success: false, error: 'Yêu cầu phải được xác thực qua POST.' });
}

// =========================================================
// 2. XỬ LÝ GHI DỮ LIỆU QUA POST (DỰ PHÒNG CHUẨN REST API)
// =========================================================
function doPost(e) {
  let lock = null;
  let lockAcquired = false;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'Thiếu nội dung yêu cầu.' });
    }
    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonResponse_({ success: false, error: 'Dữ liệu yêu cầu không hợp lệ.' });
    }

    const identity = authenticateRequest_(data.idToken);
    const action = String(data.action || '');
    authorizeAction_(identity, action);

    if (isWriteAction_(action)) {
      lock = LockService.getScriptLock();
      lockAcquired = lock.tryLock(30000);
      if (!lockAcquired) {
        return jsonResponse_({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại.' });
      }
    }

    let result;
    if (action === 'getInitialData' || action === 'getData') {
      result = getInitialData(identity);
    } else if (action === 'submitEvidence' || action === 'submitProof') {
      result = submitProof(identity.code, data.taskId || data.maViec, data.evidence || data.url);
    } else if (action === 'gradeKPI' || action === 'gradeTask') {
      result = gradeTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.finalScore ?? data.score);
    } else if (action === 'registerKPI' || action === 'registerTask') {
      result = registerTask(identity.code, data.taskId || data.maViec, identity.name, data.score || data.dinhMuc);
    } else if (action === 'assignTask') {
      result = assignTask(identity, data);
    } else if (action === 'createTask' || action === 'addNewTask') {
      result = addNewTask(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score || data.dinhMuc, data.deadline || data.hanChot, data.quota || data.chiTieu);
    } else if (action === 'getStudentViolations') {
      result = getStudentViolations(identity, data);
    } else if (action === 'saveViolation') {
      result = saveViolation(identity, data);
    } else if (action === 'saveDiscipline') {
      result = saveDiscipline(identity, data);
    } else if (action === 'getDiscipline') {
      result = { success: true, disciplines: getDiscipline_(identity) };
    } else if (action === 'createLeaveRequest') {
      result = createLeaveRequest(identity, data.ticket);
    } else if (action === 'updateLeaveStatus') {
      result = updateLeaveStatus(identity, data);
    } else if (action === 'getEquipment') {
      result = getEquipment(identity);
    } else if (action === 'createEquipmentBorrow') {
      result = createEquipmentBorrow(identity, data);
    } else if (action === 'returnEquipment') {
      result = returnEquipment(identity, data.id);
    } else if (action === 'getActionPlan') {
      result = getActionPlan(identity);
    } else if (action === 'getActionPlanFile') {
      result = getActionPlanFile(identity, data);
    } else if (action === 'uploadActionPlan') {
      result = uploadActionPlan(identity, data);
    } else {
      result = { success: false, error: 'Hành động không hợp lệ.' };
    }
    return jsonResponse_(result);
  } catch (err) {
    console.error('API error:', err);
    return jsonResponse_({ success: false, error: err.message || 'Không thể xử lý yêu cầu.' });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function authenticateRequest_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10000) {
    throw new Error('Vui lòng đăng nhập bằng tài khoản Google của trường.');
  }

  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Hệ thống chưa cấu hình xác thực Google.');

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), {
    method: 'get',
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');

  const claims = JSON.parse(response.getContentText());
  if (claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      claims.email_verified !== 'true' || Number(claims.exp) * 1000 <= Date.now()) {
    throw new Error('Không thể xác thực tài khoản Google.');
  }

  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw new Error('Tài khoản Google không có email hợp lệ.');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Nhân sự');
  if (!sheet) throw new Error('Thiếu sheet Nhân sự.');
  const values = sheet.getDataRange().getValues();
  const row = values.slice(2).find(r => String(r[2] || '').trim().toLowerCase() === email);
  if (!row) throw new Error('Tài khoản này không có trong danh sách Nhân sự.');

  const role = String(row[5] || 'GV').trim();
  const isBgh = role.toLowerCase().includes('bgh') || email === 'ptthuy.c3tp@yenbai.edu.vn';
  const permissions = permissionsFor_(role, isBgh, String(row[6] || '').trim());
  return {
    email: email,
    code: String(row[0] || '').trim(),
    name: String(row[1] || '').trim(),
    subject: String(row[3] || '').trim(),
    department: String(row[4] || '').trim(),
    role: isBgh ? 'BGH' : role,
    homeroom: String(row[6] || '').trim(),
    isTTCM: isBgh || role.toUpperCase().includes('TTCM'),
    permissions: permissions
  };
}

function permissionsFor_(role, isBgh, homeroom) {
  const permissions = ['kpi.read.self', 'kpi.register', 'leave.read', 'leave.create', 'equipment.read', 'equipment.write', 'plan.read'];
  const isTtcm = String(role || '').toUpperCase().includes('TTCM');
  if (isBgh) return permissions.concat([
    'kpi.read.all', 'kpi.manage', 'leave.read.all', 'leave.assign', 'leave.approve',
    'students.read.all', 'students.write.all', 'plan.write'
  ]);
  if (isTtcm) permissions.push('leave.read.department', 'leave.assign');
  if (homeroom) permissions.push('students.read.class', 'students.write.class');
  return permissions;
}

function authorizeAction_(identity, action) {
  const required = {
    getInitialData: 'kpi.read.self',
    getData: 'kpi.read.self',
    gradeKPI: 'kpi.manage',
    gradeTask: 'kpi.manage',
    registerKPI: 'kpi.register',
    registerTask: 'kpi.register',
    assignTask: 'kpi.manage',
    submitEvidence: 'kpi.register',
    submitProof: 'kpi.register',
    createTask: 'kpi.manage',
    addNewTask: 'kpi.manage',
    getStudentViolations: 'students.read.class',
    saveViolation: 'students.write.class',
    saveDiscipline: 'students.write.class',
    getDiscipline: 'students.read.class',
    createLeaveRequest: 'leave.create',
    updateLeaveStatus: 'leave.assign',
    getEquipment: 'equipment.read',
    createEquipmentBorrow: 'equipment.write',
    returnEquipment: 'equipment.write',
    getActionPlan: 'plan.read',
    getActionPlanFile: 'plan.read',
    uploadActionPlan: 'plan.write'
  };
  const permission = required[action];
  const hasStudentWidePermission =
    action === 'getStudentViolations' || action === 'getDiscipline'
      ? identity.permissions.includes('students.read.all')
      : ['saveViolation', 'saveDiscipline'].includes(action) &&
        identity.permissions.includes('students.write.all');
  if (!permission || (!identity.permissions.includes(permission) && !hasStudentWidePermission)) {
    throw new Error('Bạn không có quyền thực hiện thao tác này.');
  }
  if (action === 'getStudentViolations' && !identity.permissions.includes('students.read.all') &&
      !identity.permissions.includes('students.read.class')) {
    throw new Error('Bạn không có quyền tra cứu dữ liệu học sinh.');
  }
  if (['saveViolation', 'saveDiscipline'].includes(action) && !identity.permissions.includes('students.write.all') &&
      !identity.permissions.includes('students.write.class')) {
    throw new Error('Bạn không có quyền ghi nhận vi phạm học sinh.');
  }
  if (action === 'getDiscipline' && !identity.permissions.includes('students.read.all') &&
      !identity.permissions.includes('students.read.class')) {
    throw new Error('Bạn không có quyền xem dữ liệu nề nếp học sinh.');
  }
}

function isWriteAction_(action) {
  return !['getInitialData', 'getData', 'getStudentViolations', 'getDiscipline', 'getEquipment', 'getActionPlanFile'].includes(action);
}

// =========================================================
// 3. CÁC HÀM XỬ LÝ DỮ LIỆU THỰC TẾ TRONG SHEET
// =========================================================
function getInitialData(identity) {
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

      const registration = {
        rowIndex: i + 1,
        taskId: taskId,
        teacherCode: teacherCode,
        teacherName: String(rawData[i][2] || '').trim(),
        level: String(rawData[i][3] || 'Đang thực hiện').trim(),
        baseScore: Number(rawData[i][4]) || 0,
        finalScore: (rawData[i][5] !== "" && rawData[i][5] !== null && rawData[i][5] !== undefined) ? Number(rawData[i][5]) : null,
        evidence: String(rawData[i][6] || '').trim()
      };
      if (!identity || identity.permissions.includes('kpi.read.all') || teacherCode.toUpperCase() === identity.code.toUpperCase()) {
        registrations.push(registration);
      }
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
        subject: String(rawNS[i][3] || '').trim(),
        group: String(rawNS[i][4] || '').trim(),
        role: String(rawNS[i][5] || 'GV').trim(),
        homeroom: String(rawNS[i][6] || '').trim()
      });
    }
  }

  const payload = {
    success: true,
    tasks: tasks,
    registrations: registrations,
    staff: staff
  };
  if (identity) {
    payload.user = identity;
    payload.permissions = identity.permissions;
    payload.leaveRequests = getLeaveRequests_(ss, identity);
    payload.students = getStudentsForUser_(ss, identity);
    payload.disciplines = getDiscipline_(identity);
  }
  return payload;
}

function gradeTask(maGV, maViec, score) {
  const numericScore = Number(score);
  if (!String(maGV || '').trim() || !String(maViec || '').trim() ||
      !Number.isFinite(numericScore) || numericScore < 0) {
    return { success: false, error: 'Mã giáo viên, mã việc hoặc điểm chấm chưa hợp lệ.' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();
  for (let i = 0; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() &&
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      const baseScore = Number(rawData[i][4]);
      if (numericScore > baseScore) return { success: false, error: 'Điểm chấm không được vượt quá điểm KPI định mức.' };
      sheetData.getRange(row, 4).setValue("Đã xong");
      sheetData.getRange(row, 6).setValue(numericScore);
      SpreadsheetApp.flush();
      return { success: true, message: `Đã chấm điểm thành công cho ${maGV}!` };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ trong sheet data" };
}

function registerTask(maGV, maViec, tenGV, dinhMuc) {
  if (!String(maGV || '').trim() || !String(maViec || '').trim()) {
    return { success: false, error: 'Thiếu mã giáo viên hoặc mã việc.' };
  }
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
        return { success: false, error: "Giáo viên đã có trong danh sách phân công." };
      }
    }
  }

  if (taskRow < 0) return { success: false, error: 'Không tìm thấy nhiệm vụ trong Kho KPI.' };
  if (taskChiTieu > 0 && count >= taskChiTieu) return { success: false, error: 'Nhiệm vụ đã đủ chỉ tiêu đăng ký.' };
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
  if (!String(maViec || '').trim() || !String(tenViec || '').trim() ||
      !Number.isFinite(Number(dinhMuc)) || Number(dinhMuc) < 0 ||
      !Number.isFinite(Number(chiTieu)) || Number(chiTieu) < 1) {
    return { success: false, error: 'Thông tin nhiệm vụ chưa hợp lệ.' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet Kho KPI" };

  sheetKho.appendRow([String(maViec).trim().toUpperCase(), tenViec, moTa, Number(dinhMuc) || 0, hanChot, Number(chiTieu) || 1, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}

function assignTask(identity, data) {
  const code = String(data.teacherCode || '').trim().toUpperCase();
  const taskId = String(data.taskId || '').trim().toUpperCase();
  const staffSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Nhân sự');
  if (!staffSheet) return { success: false, error: 'Thiếu sheet Nhân sự.' };
  const teacher = staffSheet.getDataRange().getValues().slice(2)
    .find(row => String(row[0] || '').trim().toUpperCase() === code);
  if (!teacher || !taskId) return { success: false, error: 'Không tìm thấy giáo viên hoặc nhiệm vụ.' };
  return registerTask(code, taskId, String(teacher[1] || '').trim(), '');
}

function getLeaveRequests_(ss, identity) {
  const sheet = ss.getSheetByName('LichNghi');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const grouped = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = String(row[0] || '').trim();
    if (!id) continue;
    const ticket = grouped[id] || (grouped[id] = {
      id: id,
      teacherCode: String(row[1] || '').trim(),
      teacherName: String(row[2] || '').trim(),
      subject: String(row[3] || '').trim(),
      department: String(row[4] || '').trim(),
      reasonCategory: String(row[5] || '').trim(),
      reason: String(row[6] || '').trim(),
      status: String(row[16] || 'PENDING_TTCM').trim(),
      periods: []
    });
    ticket.periods.push({
      rowIndex: i + 1,
      leaveDate: formatSheetDate_(row[8]),
      dayOfWeek: '',
      session: String(row[9] || '').trim(),
      class: String(row[10] || '').trim(),
      periodTKB: row[11],
      periodPPCT: row[12],
      lessonName: String(row[13] || '').trim(),
      subTeacher: String(row[14] || '').trim(),
      subSubject: '',
      makeupSchedule: String(row[15] || '').trim()
    });
  }

  return Object.keys(grouped).map(id => {
    const ticket = grouped[id];
    const allowed = identity.permissions.includes('leave.read.all') ||
      ticket.teacherCode.toUpperCase() === identity.code.toUpperCase() ||
      ticket.periods.some(p => p.subTeacher && p.subTeacher.toLowerCase() === identity.name.toLowerCase()) ||
      (identity.permissions.includes('leave.read.department') &&
        ticket.department.toLowerCase() === identity.department.toLowerCase());
    if (!allowed) return null;
    ticket.classesTeaching = [...new Set(ticket.periods.map(p => p.class).filter(Boolean))].join(', ');
    ticket.timeDisplay = [...new Set(ticket.periods.map(p => p.leaveDate))].join('; ');
    return ticket;
  }).filter(Boolean);
}

function createLeaveRequest(identity, ticket) {
  if (!ticket || !Array.isArray(ticket.periods) || ticket.periods.length < 1 || ticket.periods.length > 20) {
    return { success: false, error: 'Đơn nghỉ phải có từ 1 đến 20 tiết.' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('LichNghi');
  if (!sheet) return { success: false, error: 'Thiếu sheet LichNghi.' };

  const reasonCategory = String(ticket.reasonCategory || '').trim().slice(0, 100);
  const reason = String(ticket.reason || '').trim().slice(0, 1000);
  const id = 'NP-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd-HHmmss') + '-' +
    Utilities.getUuid().slice(0, 6).toUpperCase();
  const now = new Date();
  const rows = ticket.periods.map(period => {
    const date = parseIsoDate_(period.rawDate);
    if (!date || !String(period.class || '').trim() || !String(period.lessonName || '').trim()) {
      throw new Error('Thông tin ngày, lớp hoặc tên bài dạy trong đơn chưa hợp lệ.');
    }
    const periodTkb = Number(period.periodTKB);
    const periodPpct = Number(period.periodPPCT);
    if (!Number.isInteger(periodTkb) || periodTkb < 1 || periodTkb > 12 ||
        !Number.isInteger(periodPpct) || periodPpct < 1) {
      throw new Error('Tiết TKB hoặc PPCT trong đơn chưa hợp lệ.');
    }
    return [
      id, identity.code, identity.name, identity.subject, identity.department,
      reasonCategory, reason, now, date, String(period.session || '').slice(0, 20),
      String(period.class).trim().slice(0, 30), periodTkb, periodPpct,
      String(period.lessonName).trim().slice(0, 200), '', 'Chưa dạy bù',
      'PENDING_TTCM', '', '', now
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.flush();
  return { success: true, id: id, message: 'Đã lưu đơn nghỉ.' };
}

function updateLeaveStatus(identity, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('LichNghi');
  if (!sheet) return { success: false, error: 'Thiếu sheet LichNghi.' };
  const ticketId = String(data.ticketId || '').trim();
  const status = String(data.status || '').trim();
  const values = sheet.getDataRange().getValues();
  const rowIndexes = [];
  let ownerCode = '';
  let department = '';
  const currentStatuses = new Set();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== ticketId) continue;
    rowIndexes.push(i + 1);
    ownerCode = String(values[i][1] || '').trim();
    department = String(values[i][4] || '').trim();
    currentStatuses.add(String(values[i][16] || '').trim());
  }
  if (!rowIndexes.length) return { success: false, error: 'Không tìm thấy đơn nghỉ.' };

  if (status === 'PENDING_BGH') {
    if (!identity.permissions.includes('leave.assign') ||
        (!identity.permissions.includes('leave.read.all') && department.toLowerCase() !== identity.department.toLowerCase())) {
      throw new Error('Bạn không có quyền xếp lịch cho đơn này.');
    }
    if (!currentStatuses.has('PENDING_TTCM') || !Array.isArray(data.periods) ||
        data.periods.length !== rowIndexes.length) {
      throw new Error('Đơn không còn ở trạng thái chờ TTCM hoặc dữ liệu phân công không khớp.');
    }
    data.periods.forEach((period, index) => {
      if (!String(period.subTeacher || '').trim()) throw new Error('Mỗi tiết cần có giáo viên dạy thay.');
      sheet.getRange(rowIndexes[index], 15, 1, 2).setValues([[
        String(period.subTeacher).trim().slice(0, 100),
        String(period.makeupSchedule || 'Chưa dạy bù').trim().slice(0, 200)
      ]]);
    });
  } else if (status === 'APPROVED_BGH') {
    if (!identity.permissions.includes('leave.approve')) throw new Error('Chỉ BGH mới được duyệt đơn.');
    if (!currentStatuses.has('PENDING_BGH')) throw new Error('Đơn không còn ở trạng thái chờ BGH.');
  } else {
    throw new Error('Trạng thái duyệt không hợp lệ.');
  }

  rowIndexes.forEach(row => {
    sheet.getRange(row, 17).setValue(status);
    sheet.getRange(row, 18).setValue(new Date());
  });
  SpreadsheetApp.flush();
  return { success: true, message: 'Đã cập nhật trạng thái đơn nghỉ.' };
}

function getStudentsForUser_(ss, identity) {
  const sheet = ss.getSheetByName('HS');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[0] && (identity.permissions.includes('students.read.all') ||
      String(row[1] || '').trim().toLowerCase() === identity.homeroom.toLowerCase()))
    .map(row => ({ maHS: String(row[0]).trim(), lop: String(row[1]).trim(), hoTen: String(row[2]).trim() }));
}

function getStudentViolations(identity, filters) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('dataHS');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };
  const rows = sheet.getDataRange().getValues();
  const fromDate = parseIsoDate_(filters.fromDate);
  const toDate = parseIsoDate_(filters.toDate);
  const code = String(filters.maHS || '').trim().toLowerCase();
  const name = String(filters.hoTen || '').trim().toLowerCase();
  const requestedClass = String(filters.className || '').trim().toLowerCase();
  if (requestedClass && !identity.permissions.includes('students.read.all')) {
    throw new Error('Bạn không có quyền chọn lớp khác lớp chủ nhiệm.');
  }
  if (requestedClass) {
    const classes = new Set(ss.getSheetByName('HS').getDataRange().getValues().slice(1)
      .map(row => String(row[1] || '').trim().toLowerCase()));
    if (!classes.has(requestedClass)) return { success: false, error: 'Lớp cần tra cứu không tồn tại.' };
  }
  const data = rows.slice(1).map((row, index) => ({
    rowIndex: index + 2,
    maHS: String(row[0] || '').trim(),
    date: formatSheetDate_(row[1]),
    class: String(row[2] || '').trim(),
    student: String(row[3] || '').trim(),
    errors: rows[0].slice(4, 19).filter((label, i) => label && Number(row[i + 4]) > 0)
      .map(label => String(label).trim())
  })).filter(item => item.maHS && item.student)
    .filter(item => identity.permissions.includes('students.read.all') ||
      item.class.toLowerCase() === identity.homeroom.toLowerCase())
    .filter(item => !code || item.maHS.toLowerCase().includes(code))
    .filter(item => !name || item.student.toLowerCase().includes(name))
    .filter(item => !requestedClass || item.class.toLowerCase() === requestedClass)
    .filter(item => {
      const date = parseDisplayDate_(item.date);
      return (!fromDate || (date && date >= fromDate)) && (!toDate || (date && date <= toDate));
    }).map(item => ({ ...item, ngay: item.date, lop: item.class, hoTen: item.student }));
  return { success: true, data: data };
}

function saveViolation(identity, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const studentsSheet = ss.getSheetByName('HS');
  const targetSheet = ss.getSheetByName('dataHS');
  if (!studentsSheet || !targetSheet) return { success: false, error: 'Thiếu sheet HS hoặc dataHS.' };
  const code = String(data.maHS || '').trim();
  const student = studentsSheet.getDataRange().getValues().slice(1)
    .find(row => String(row[0] || '').trim() === code);
  if (!student) return { success: false, error: 'Không tìm thấy học sinh trong sheet HS.' };
  const className = String(student[1] || '').trim();
  if (!identity.permissions.includes('students.write.all') &&
      className.toLowerCase() !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được ghi nhận học sinh thuộc lớp chủ nhiệm.');
  }

  const header = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
  const allowed = header.slice(4, 19).filter(Boolean).map(String);
  const selected = Array.isArray(data.selectedErrors) ? data.selectedErrors : [];
  if (!selected.length || selected.some(error => !allowed.includes(String(error)))) {
    return { success: false, error: 'Danh sách lỗi vi phạm không hợp lệ.' };
  }
  const date = parseIsoDate_(data.ngay) || parseDisplayDate_(String(data.ngay || ''));
  if (!date) return { success: false, error: 'Ngày vi phạm không hợp lệ.' };
  const row = [code, date, className, String(student[2]).trim()];
  allowed.forEach(error => row.push(selected.includes(error) ? 1 : ''));
  targetSheet.appendRow(row);
  SpreadsheetApp.flush();
  return { success: true, message: 'Đã lưu ghi nhận vi phạm.' };
}

function getDiscipline_(identity) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('NeNep');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => row[1] && (identity.permissions.includes('students.read.all') ||
      String(row[2] || '').toLowerCase() === identity.homeroom.toLowerCase()))
    .map(row => ({
      date: formatSheetDate_(row[0]), studentCode: String(row[1]), class: String(row[2]),
      student: String(row[3]), content: String(row[4]), points: Number(row[5]) || 0,
      recorder: String(row[6])
    }));
}

function saveDiscipline(identity, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const students = ss.getSheetByName('HS');
  if (!students) return { success: false, error: 'Thiếu sheet HS.' };
  const className = String(data.class || '').trim();
  const studentName = String(data.student || '').trim();
  const studentRows = students.getDataRange().getValues().slice(1)
    .filter(row => String(row[1] || '').trim().toLowerCase() === className.toLowerCase() &&
      String(row[2] || '').trim().toLowerCase() === studentName.toLowerCase());
  if (studentRows.length !== 1) return { success: false, error: 'Không tìm thấy duy nhất một học sinh khớp lớp và họ tên.' };
  if (!identity.permissions.includes('students.write.all') && className.toLowerCase() !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được ghi nhận học sinh thuộc lớp chủ nhiệm.');
  }
  const content = String(data.content || '').trim();
  const points = Number(data.points);
  if (!content || content.length > 1000 || !Number.isFinite(points) || Math.abs(points) > 100) {
    return { success: false, error: 'Nội dung hoặc điểm nề nếp chưa hợp lệ.' };
  }
  const sheet = getOrCreateSheet_('NeNep', ['Ngày', 'Mã HS', 'Lớp', 'Họ tên', 'Nội dung', 'Điểm', 'Người ghi nhận']);
  sheet.appendRow([new Date(), String(studentRows[0][0]), className, studentName, content, points, identity.name]);
  return { success: true, message: 'Đã lưu ghi nhận nề nếp.' };
}

function getEquipment(identity) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('ThietBi');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, equipment: [] };
  const values = sheet.getDataRange().getValues();
  return {
    success: true,
    equipment: values.slice(1).filter(row => row[0] &&
      (identity.permissions.includes('leave.read.all') || String(row[1]).toUpperCase() === identity.code.toUpperCase()))
      .map(row => ({
        id: String(row[0]), teacherCode: String(row[1]), teacherName: String(row[2]),
        item: String(row[3]), period: String(row[4]), date: formatSheetDate_(row[5]), status: String(row[6])
      }))
  };
}

function createEquipmentBorrow(identity, data) {
  const name = String(data.item || '').trim();
  const period = String(data.period || '').trim();
  const date = parseIsoDate_(data.date);
  if (!name || name.length > 200 || !period || period.length > 200 || !date) {
    return { success: false, error: 'Thông tin thiết bị mượn chưa hợp lệ.' };
  }
  const sheet = getOrCreateSheet_('ThietBi', ['Mã mượn', 'Mã GV', 'Tên GV', 'Thiết bị', 'Tiết/Lớp', 'Ngày mượn', 'Trạng thái']);
  const id = 'TB-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sheet.appendRow([id, identity.code, identity.name, name, period, date, 'Đang mượn']);
  return { success: true, id: id };
}

function returnEquipment(identity, id) {
  const sheet = getOrCreateSheet_('ThietBi', ['Mã mượn', 'Mã GV', 'Tên GV', 'Thiết bị', 'Tiết/Lớp', 'Ngày mượn', 'Trạng thái']);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(id)) continue;
    if (!identity.permissions.includes('leave.read.all') &&
        String(values[i][1]).toUpperCase() !== identity.code.toUpperCase()) {
      throw new Error('Bạn không có quyền trả thiết bị này.');
    }
    sheet.getRange(i + 1, 7).setValue('Đã trả');
    return { success: true };
  }
  return { success: false, error: 'Không tìm thấy lượt mượn thiết bị.' };
}

function getActionPlan(identity) {
  const sheet = getOrCreatePlanSheet_();
  const rows = sheet.getDataRange().getValues().slice(1);
  const data = rows.filter(row => row[0]).map(row => ({
    id: String(row[0]), type: String(row[1]), weekNum: Number(row[2]) || 0,
    title: String(row[3]), fileName: String(row[4] || ''),
    hasFile: Boolean(row[5]),
    updatedAt: row[6] ? formatSheetDateTime_(row[6]) : '--'
  }));
  return { success: true, months: data.filter(item => item.type === 'month'), weeks: data.filter(item => item.type === 'week') };
}

function getActionPlanFile(identity, data) {
  const id = String(data.id || '');
  const type = String(data.type || '');
  const sheet = getOrCreatePlanSheet_();
  const row = sheet.getDataRange().getValues().slice(1)
    .find(item => String(item[0]) === id && String(item[1]) === type);
  if (!row || !row[5]) return { success: false, error: 'Không tìm thấy tệp kế hoạch.' };
  const file = DriveApp.getFileById(String(row[5]));
  const blob = file.getBlob();
  return {
    success: true,
    fileName: String(row[4] || file.getName()),
    contentType: 'application/pdf',
    fileData: Utilities.base64Encode(blob.getBytes())
  };
}

function uploadActionPlan(identity, data) {
  const type = String(data.type || '');
  const id = String(data.id || '');
  const fileName = String(data.fileName || '').trim();
  const base64 = String(data.fileData || '').replace(/^data:application\/pdf;base64,/, '');
  const maxBase64Length = Math.ceil((8 * 1024 * 1024) / 3) * 4;
  if (!['month', 'week'].includes(type) || !fileName.toLowerCase().endsWith('.pdf') ||
      !base64 || base64.length > maxBase64Length) {
    return { success: false, error: 'Chỉ nhận tệp PDF hợp lệ dưới 8 MB.' };
  }
  const sheet = getOrCreatePlanSheet_();
  const rows = sheet.getDataRange().getValues();
  const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[0]) === id && String(row[1]) === type);
  if (rowIndex < 1) return { success: false, error: 'Không tìm thấy vị trí kế hoạch.' };
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 8 * 1024 * 1024 || bytes.length < 5 ||
      bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { success: false, error: 'Nội dung tệp tải lên không phải PDF hợp lệ hoặc vượt quá 8 MB.' };
  }
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const file = DriveApp.createFile(Utilities.newBlob(bytes, 'application/pdf', safeName));
  sheet.getRange(rowIndex + 1, 5, 1, 3).setValues([[
    safeName, file.getId(), new Date()
  ]]);
  return { success: true, fileId: file.getId(), message: 'Đã tải kế hoạch lên.' };
}

function getOrCreatePlanSheet_() {
  const sheet = getOrCreateSheet_('KeHoach', ['Mã', 'Loại', 'Tuần', 'Tiêu đề', 'Tên tệp', 'Drive ID', 'Cập nhật']);
  if (sheet.getLastRow() === 1) {
    const rows = [];
    for (let index = 1; index <= 12; index++) {
      const month = index <= 5 ? index + 7 : index - 5;
      const year = index <= 5 ? 2026 : 2027;
      rows.push(['M-' + index, 'month', 0, 'Tháng ' + String(month).padStart(2, '0') + '/' + year, '', '', '']);
    }
    for (let week = 1; week <= 40; week++) {
      rows.push(['W-' + String(week).padStart(2, '0'), 'week', week, 'Tuần ' + String(week).padStart(2, '0'), '', '', '']);
    }
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  return sheet;
}

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function parseIsoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3]) ? date : null;
}

function parseDisplayDate_(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return parseIsoDate_(match[3] + '-' + match[2] + '-' + match[1]);
}

function formatSheetDate_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'GMT+7', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

function formatSheetDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'GMT+7', 'dd/MM/yyyy HH:mm');
  }
  return String(value || '');
}
