const SPREADSHEET_ID = '1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';
const API_READ_ACTIONS_ = ['getInitialData', 'getData', 'getStudentViolations', 'getDiscipline', 'getEquipment', 'getActionPlan', 'getActionPlanFile'];

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const data = Object.assign({}, params, { action: params.action || 'getInitialData' });
  if (!API_READ_ACTIONS_.includes(data.action)) {
    return jsonResponse_({ success: false, error: 'Các thao tác ghi dữ liệu phải sử dụng POST.' });
  }
  return routeApiRequest_(data);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'Thiếu nội dung yêu cầu.' });
    }
    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonResponse_({ success: false, error: 'Dữ liệu yêu cầu không hợp lệ.' });
    }
    return routeApiRequest_(data);
  } catch (error) {
    console.error('API request error:', error);
    return jsonResponse_({ success: false, error: error.message || 'Không thể xử lý yêu cầu.' });
  }
}

function routeApiRequest_(data) {
  let lock;
  let lockAcquired = false;
  try {
    const action = String(data.action || '');
    const identity = authenticateRequest_(data.idToken);
    authorizeAction_(identity, action);

    if (API_READ_ACTIONS_.indexOf(action) === -1) {
      lock = LockService.getScriptLock();
      lockAcquired = lock.tryLock(30000);
      if (!lockAcquired) throw new Error('Hệ thống đang bận, vui lòng thử lại.');
    }

    let result;
    switch (action) {
      case 'getInitialData':
      case 'getData':
        result = getInitialData(identity);
        break;
      case 'submitEvidence':
      case 'submitProof':
        result = submitProof(identity.code, data.taskId || data.maViec, data.evidence || data.url);
        break;
      case 'gradeKPI':
      case 'gradeTask':
        result = gradeTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.finalScore ?? data.score);
        break;
      case 'registerKPI':
      case 'registerTask':
        result = registerTask(identity.code, data.taskId || data.maViec, identity.name);
        break;
      case 'assignTask':
        result = assignTask_(identity, data);
        break;
      case 'createTask':
      case 'addNewTask':
        result = addNewTask(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score ?? data.dinhMuc, data.deadline || data.hanChot, data.quota ?? data.chiTieu);
        break;
      case 'getStudentViolations':
        result = getStudentViolations_(identity, data);
        break;
      case 'saveViolation':
        result = saveViolation_(identity, data);
        break;
      case 'saveDiscipline':
        result = saveDiscipline_(identity, data);
        break;
      case 'getDiscipline':
        result = { success: true, disciplines: getDiscipline_(identity) };
        break;
      case 'createLeaveRequest':
        result = createLeaveRequest_(identity, data.ticket);
        break;
      case 'updateLeaveStatus':
        result = updateLeaveStatus_(identity, data);
        break;
      case 'getEquipment':
        result = { success: true, equipment: getEquipment_(identity) };
        break;
      case 'createEquipmentBorrow':
        result = createEquipmentBorrow_(identity, data);
        break;
      case 'returnEquipment':
        result = returnEquipment_(identity, data.id);
        break;
      case 'getActionPlan':
        result = getActionPlan_();
        break;
      case 'getActionPlanFile':
        result = getActionPlanFile_(data);
        break;
      case 'uploadActionPlan':
        result = uploadActionPlan_(data);
        break;
      default:
        throw new Error('Action không được hỗ trợ: ' + action);
    }
    return jsonResponse_(result);
  } catch (error) {
    console.error('API action failed:', error);
    return jsonResponse_({ success: false, error: error.message || 'Không thể xử lý yêu cầu.' });
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
  const clientId = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com"; //PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Chưa cấu hình GOOGLE_CLIENT_ID trong Script Properties.');

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { method: 'get', muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) throw new Error('Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.');
  const claims = JSON.parse(response.getContentText());
  if (claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      String(claims.email_verified) !== 'true' || Number(claims.exp) * 1000 <= Date.now()) {
    throw new Error('Không thể xác thực tài khoản Google.');
  }

  const email = String(claims.email || '').trim().toLowerCase();
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Nhân sự');
  if (!email || !sheet) throw new Error('Thiếu email hoặc sheet Nhân sự.');
  const rows = sheet.getDataRange().getValues();
  const staff = rows.slice(2).find(row => String(row[2] || '').trim().toLowerCase() === email);
  if (!staff || !staff[0]) throw new Error('Tài khoản không có trong sheet Nhân sự.');

  const sourceRole = String(staff[5] || 'GV').trim();
  const normalizedRole = sourceRole.toUpperCase();
  const isBgh = normalizedRole.includes('BGH') || normalizedRole.includes('HIỆU TRƯỞNG') ||
    normalizedRole.includes('PHT') || normalizedRole.includes('PHÓ HIỆU TRƯỞNG');
  const role = isBgh ? 'BGH' : sourceRole;
  const isTtcm = normalizedRole.includes('TTCM') || normalizedRole.includes('TỔ TRƯỞNG');
  const homeroom = String(staff[6] || '').trim();
  const permissions = ['kpi.read.self', 'kpi.register', 'leave.read', 'leave.create', 'equipment.read', 'equipment.write', 'plan.read'];
  if (isBgh) permissions.push('kpi.read.all', 'kpi.manage', 'leave.read.all', 'leave.assign', 'leave.approve', 'students.read.all', 'students.write.all', 'plan.write');
  if (isTtcm) permissions.push('leave.read.department', 'leave.assign');
  if (homeroom) permissions.push('students.read.class', 'students.write.class');

  return {
    email: email,
    code: String(staff[0]).trim(),
    name: String(staff[1] || claims.name || '').trim(),
    subject: String(staff[3] || '').trim(),
    department: String(staff[4] || '').trim(),
    role: role,
    position: sourceRole,
    homeroom: homeroom,
    isTTCM: isBgh || isTtcm,
    permissions: permissions
  };
}

function authorizeAction_(identity, action) {
  const permissions = identity.permissions;
  const required = {
    getInitialData: 'kpi.read.self', getData: 'kpi.read.self',
    submitEvidence: 'kpi.register', submitProof: 'kpi.register',
    gradeKPI: 'kpi.manage', gradeTask: 'kpi.manage',
    registerKPI: 'kpi.register', registerTask: 'kpi.register',
    assignTask: 'kpi.manage', createTask: 'kpi.manage', addNewTask: 'kpi.manage',
    getStudentViolations: 'students.read.class', saveViolation: 'students.write.class',
    getDiscipline: 'students.read.class', saveDiscipline: 'students.write.class',
    createLeaveRequest: 'leave.create', updateLeaveStatus: 'leave.assign',
    getEquipment: 'equipment.read', createEquipmentBorrow: 'equipment.write',
    returnEquipment: 'equipment.write', getActionPlan: 'plan.read',
    getActionPlanFile: 'plan.read', uploadActionPlan: 'plan.write'
  };
  const permission = required[action];
  if (!permission || permissions.indexOf(permission) === -1) {
    throw new Error('Bạn không có quyền thực hiện thao tác này.');
  }
  if (action === 'getDiscipline' && !permissions.includes('students.read.all') && !identity.homeroom) {
    throw new Error('Tài khoản chưa được phân công lớp chủ nhiệm.');
  }
}

function text_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function sheetRows_(sheetName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  return sheet && sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
}

function getSheetOrCreate_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function formatSheetDate_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'GMT+7', 'dd/MM/yyyy');
  return text_(value);
}

function formatSheetDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'GMT+7', 'dd/MM/yyyy HH:mm');
  return text_(value);
}

function parseApiDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const source = text_(value);
  let match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const isoDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isoDate.getFullYear() === Number(match[1]) && isoDate.getMonth() === Number(match[2]) - 1 &&
      isoDate.getDate() === Number(match[3]) ? isoDate : null;
  }
  match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? parseApiDate_(match[3] + '-' + match[2] + '-' + match[1]) : null;
}

function getStudents_(identity) {
  return sheetRows_('HS').slice(1)
    .filter(row => row[0] && (identity.permissions.includes('students.read.all') ||
      text_(row[1]).toLowerCase() === identity.homeroom.toLowerCase()))
    .map(row => ({ maHS: text_(row[0]), lop: text_(row[1]), hoTen: text_(row[2]) }));
}

// 1. ĐỌC DỮ LIỆU
function getInitialData(identity) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const tasks = [];
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 0; i < rawKho.length; i++) {
      const id = text_(rawKho[i][0]);
      if (id && !id.toUpperCase().includes('MÃ VIỆC') && !id.toUpperCase().includes('BẢNG')) {
        tasks.push({
          id: id,
          title: text_(rawKho[i][1]),
          desc: text_(rawKho[i][2]),
          score: Number(rawKho[i][3]) || 0,
          deadline: formatSheetDate_(rawKho[i][4]),
          quota: Number(rawKho[i][5]) || 0,
          status: text_(rawKho[i][6]) || 'Còn việc'
        });
      }
    }
  }

  const sheetData = ss.getSheetByName('data');
  const registrations = [];
  if (sheetData) {
    const rawData = sheetData.getDataRange().getValues();
    for (let i = 1; i < rawData.length; i++) {
      if (rawData[i][0] && rawData[i][1] && (!identity || identity.permissions.includes('kpi.read.all') ||
          text_(rawData[i][1]).toUpperCase() === identity.code.toUpperCase())) {
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
    for (let i = 2; i < rawNS.length; i++) {
      if (rawNS[i][0]) {
        const staffPosition = String(rawNS[i][5] || '').trim();
        const staffRoleUpper = staffPosition.toUpperCase();
        const isBghStaff = staffRoleUpper.includes('BGH') || staffRoleUpper.includes('HIỆU TRƯỞNG') ||
          staffRoleUpper.includes('PHT') || staffRoleUpper.includes('PHÓ HIỆU TRƯỞNG');
        staff.push({
          code: String(rawNS[i][0]).trim(),
          name: String(rawNS[i][1] || '').trim(),
          email: String(rawNS[i][2] || '').trim().toLowerCase(),
          subject: String(rawNS[i][3] || '').trim(),
          group: String(rawNS[i][4] || '').trim(),
          department: String(rawNS[i][4] || '').trim(),
          role: isBghStaff ? 'BGH' : (staffPosition || 'GV'),
          position: staffPosition,
          isTTCM: staffRoleUpper.includes('TTCM') || staffRoleUpper.includes('TỔ TRƯỞNG'),
          homeroom: String(rawNS[i][6] || '').trim()
        });
      }
    }
  }

  const violationHeader = sheetRows_('dataHS')[0] || [];
  const actionPlans = getActionPlan_();
  return {
    success: true,
    user: identity,
    permissions: identity.permissions,
    tasks: tasks,
    registrations: registrations,
    staff: staff,
    students: getStudents_(identity),
    violationTypes: violationHeader.slice(4).filter(Boolean).map(text_),
    disciplines: getDiscipline_(identity),
    leaveRequests: getLeaveRequests_(ss, identity),
    equipmentBorrows: getEquipment_(identity),
    monthPlans: actionPlans.months,
    weekPlans: actionPlans.weeks
  };
}

// 2. CHẤM ĐIỂM (CẬP NHẬT CỘT F: Điểm KPI quản lý chấm TRONG SHEET DATA)
function gradeTask(maGV, maViec, score) {
  const numericScore = Number(score);
  if (!text_(maGV) || !text_(maViec) || !Number.isFinite(numericScore) || numericScore < 0) {
    return { success: false, error: 'Mã giáo viên, mã việc hoặc điểm chấm chưa hợp lệ.' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();

  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() && 
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      const baseScore = Number(rawData[i][4]) || 0;
      if (numericScore > baseScore) return { success: false, error: 'Điểm chấm không được vượt quá điểm KPI định mức.' };
      sheetData.getRange(row, 4).setValue("Đã xong");
      sheetData.getRange(row, 6).setValue(numericScore);
      SpreadsheetApp.flush();
      return { success: true, message: `Đã chấm điểm thành công cho ${maGV}!` };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ trong sheet data" };
}

// 3. ĐĂNG KÝ HOẶC GIAO NHIỆM VỤ (GHI DÒNG MỚI VÀO SHEET DATA)
function registerTask(maGV, maViec, tenGV, dinhMuc) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const sheetNS = ss.getSheetByName('Nhân sự');
  if (!sheetData || !text_(maGV) || !text_(maViec)) {
    return { success: false, error: 'Thiếu sheet data hoặc mã giáo viên/mã việc.' };
  }

  if (!tenGV && sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 2; i < rawNS.length; i++) {
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

  const rawData = sheetData.getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase()) {
      count++;
      if (String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
        return { success: false, error: "Giáo viên đã có trong danh sách phân công." };
      }
    }
  }
  if (taskRow < 0) return { success: false, error: 'Không tìm thấy nhiệm vụ trong Kho KPI.' };
  if (taskChiTieu > 0 && count >= taskChiTieu) return { success: false, error: 'Nhiệm vụ đã đủ chỉ tiêu đăng ký.' };

  // Ghi đúng 7 cột vào sheet data: [Mã việc, Mã GV, Tên GV, Trạng thái, Điểm KPI định mức, Điểm KPI quản lý chấm, Minh chứng]
  sheetData.appendRow([String(maViec).trim().toUpperCase(), String(maGV).trim().toUpperCase(), tenGV || '', "Đang thực hiện", taskDinhMuc, "", ""]);

  // Cập nhật trạng thái Kho KPI nếu hết chỉ tiêu
  if (taskChiTieu > 0 && count + 1 >= taskChiTieu && taskRow > 0 && sheetKho) {
    sheetKho.getRange(taskRow, 7).setValue('Hết việc');
  }

  SpreadsheetApp.flush();
  return { success: true, message: "Đã giao/đăng ký việc thành công và lưu vào sheet data!" };
}

// 4. NỘP MINH CHỨNG
function submitProof(maGV, maViec, url) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = ss.getSheetByName('data');
  const evidence = text_(url);
  if (!sheetData || !text_(maGV) || !text_(maViec) ||
      (evidence && !/^https?:\/\/\S+$/i.test(evidence))) {
    return { success: false, error: 'Thông tin minh chứng chưa hợp lệ.' };
  }
  const rawData = sheetData.getDataRange().getValues();

  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === String(maViec).trim().toUpperCase() && 
        String(rawData[i][1]).trim().toUpperCase() === String(maGV).trim().toUpperCase()) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Chờ nghiệm thu");
      sheetData.getRange(row, 7).setValue(evidence);
      SpreadsheetApp.flush();
      return { success: true, message: "Nộp minh chứng thành công!" };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ" };
}

// 5. THÊM VIỆC MỚI VÀO KHO KPI
function addNewTask(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet Kho KPI" };

  const id = text_(maViec).toUpperCase();
  const title = text_(tenViec);
  const score = Number(dinhMuc);
  const quota = Number(chiTieu);
  const deadline = text_(hanChot);
  if (!id || !title || !Number.isFinite(score) || score < 0 || !Number.isInteger(quota) || quota < 1) {
    return { success: false, error: 'Thông tin nhiệm vụ chưa hợp lệ.' };
  }
  if (deadline && !parseApiDate_(deadline)) return { success: false, error: 'Hạn hoàn thành không hợp lệ.' };
  if (sheetKho.getDataRange().getValues().some(row => text_(row[0]).toUpperCase() === id)) {
    return { success: false, error: 'Mã việc đã tồn tại trong Kho KPI.' };
  }
  sheetKho.appendRow([id, title, text_(moTa), score, parseApiDate_(deadline) || '', quota, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}

function assignTask_(identity, data) {
  if (!identity.permissions.includes('kpi.manage')) throw new Error('Chỉ BGH mới được giao KPI.');
  const code = text_(data.teacherCode || data.maGV).toUpperCase();
  const staff = sheetRows_('Nhân sự').slice(2).find(row => text_(row[0]).toUpperCase() === code);
  if (!staff) return { success: false, error: 'Không tìm thấy giáo viên trong sheet Nhân sự.' };
  return registerTask(code, data.taskId || data.maViec, text_(staff[1]));
}

function getLeaveRequests_(ss, identity) {
  const sheet = ss.getSheetByName('LichNghi');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const grouped = {};
  sheet.getDataRange().getValues().slice(1).forEach((row, index) => {
    const id = text_(row[0]);
    if (!id) return;
    const ticket = grouped[id] || (grouped[id] = {
      id: id, teacherCode: text_(row[1]), teacherName: text_(row[2]), subject: text_(row[3]),
      department: text_(row[4]), reasonCategory: text_(row[5]), reason: text_(row[6]),
      status: text_(row[16]) || 'PENDING_TTCM', periods: []
    });
    ticket.periods.push({
      rowIndex: index + 2, leaveDate: formatSheetDate_(row[8]), dayOfWeek: '',
      session: text_(row[9]), class: text_(row[10]), periodTKB: row[11],
      periodPPCT: row[12], lessonName: text_(row[13]), subTeacher: text_(row[14]),
      subSubject: '', makeupSchedule: text_(row[15])
    });
  });
  return Object.keys(grouped).map(id => {
    const ticket = grouped[id];
    const canRead = identity.permissions.includes('leave.read.all') ||
      ticket.teacherCode.toUpperCase() === identity.code.toUpperCase() ||
      ticket.periods.some(period => period.subTeacher.toLowerCase() === identity.name.toLowerCase()) ||
      (identity.permissions.includes('leave.read.department') &&
        ticket.department.toLowerCase() === identity.department.toLowerCase());
    if (!canRead) return null;
    ticket.classesTeaching = [...new Set(ticket.periods.map(period => period.class).filter(Boolean))].join(', ');
    ticket.timeDisplay = [...new Set(ticket.periods.map(period => period.leaveDate))].join('; ');
    ticket.periods.forEach(period => {
      const date = parseApiDate_(period.leaveDate);
      if (date) period.dayOfWeek = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][date.getDay()];
    });
    return ticket;
  }).filter(Boolean);
}

function createLeaveRequest_(identity, ticket) {
  if (!ticket || !Array.isArray(ticket.periods) || ticket.periods.length < 1 || ticket.periods.length > 20) {
    return { success: false, error: 'Đơn nghỉ phải có từ 1 đến 20 tiết.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('LichNghi');
  if (!sheet) return { success: false, error: 'Thiếu sheet LichNghi.' };
  const id = 'NP-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
  const now = new Date();
  const reasonCategory = text_(ticket.reasonCategory).slice(0, 100);
  const reason = text_(ticket.reason).slice(0, 1000);
  if (!reasonCategory || !reason) return { success: false, error: 'Vui lòng nhập loại lý do và nội dung nghỉ.' };
  const rows = ticket.periods.map(period => {
    const date = parseApiDate_(period.rawDate || period.leaveDate);
    const periodTkb = Number(period.periodTKB);
    const periodPpct = Number(period.periodPPCT);
    if (!date || !text_(period.class) || !text_(period.lessonName) ||
        !Number.isInteger(periodTkb) || periodTkb < 1 || periodTkb > 12 ||
        !Number.isInteger(periodPpct) || periodPpct < 1) {
      throw new Error('Ngày, lớp, bài dạy hoặc tiết TKB/PPCT chưa hợp lệ.');
    }
    return [id, identity.code, identity.name, identity.subject, identity.department, reasonCategory,
      reason, now, date, text_(period.session).slice(0, 20), text_(period.class).slice(0, 30),
      periodTkb, periodPpct, text_(period.lessonName).slice(0, 200), '', 'Chưa dạy bù',
      'PENDING_TTCM', ''];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.flush();
  return { success: true, id: id, message: 'Đã lưu đơn nghỉ.' };
}

function updateLeaveStatus_(identity, data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('LichNghi');
  if (!sheet) return { success: false, error: 'Thiếu sheet LichNghi.' };
  const ticketId = text_(data.ticketId);
  const rows = sheet.getDataRange().getValues();
  const matches = [];
  rows.slice(1).forEach((row, index) => {
    if (text_(row[0]) === ticketId) matches.push({ row: row, index: index + 2 });
  });
  if (!matches.length) return { success: false, error: 'Không tìm thấy đơn nghỉ.' };

  const status = text_(data.status);
  const currentStatuses = new Set(matches.map(match => text_(match.row[16])));
  if (status === 'PENDING_BGH') {
    const department = text_(matches[0].row[4]);
    if (!identity.permissions.includes('leave.assign') ||
        (!identity.permissions.includes('leave.read.all') && department.toLowerCase() !== identity.department.toLowerCase())) {
      throw new Error('Bạn không có quyền phân công dạy thay cho đơn này.');
    }
    if (!currentStatuses.has('PENDING_TTCM') || !Array.isArray(data.periods) || data.periods.length !== matches.length) {
      throw new Error('Trạng thái đơn hoặc dữ liệu dạy thay không còn hợp lệ.');
    }
    data.periods.forEach((period, index) => {
      if (!text_(period.subTeacher)) throw new Error('Mỗi tiết phải có giáo viên dạy thay.');
      sheet.getRange(matches[index].index, 15, 1, 2).setValues([[
        text_(period.subTeacher).slice(0, 100), text_(period.makeupSchedule || 'Chưa dạy bù').slice(0, 200)
      ]]);
    });
  } else if (status === 'APPROVED_BGH') {
    if (!identity.permissions.includes('leave.approve') || !currentStatuses.has('PENDING_BGH')) {
      throw new Error('Chỉ BGH mới được duyệt đơn đang chờ phê duyệt.');
    }
  } else {
    throw new Error('Trạng thái duyệt đơn không hợp lệ.');
  }
  matches.forEach(match => {
    sheet.getRange(match.index, 17).setValue(status);
    sheet.getRange(match.index, 18).setValue(new Date());
  });
  SpreadsheetApp.flush();
  return { success: true, message: 'Đã cập nhật trạng thái đơn nghỉ.' };
}

function getStudentViolations_(identity, filters) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('dataHS');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };
  const values = sheet.getDataRange().getValues();
  const fromDate = parseApiDate_(filters.fromDate);
  const toDate = parseApiDate_(filters.toDate);
  const code = text_(filters.maHS).toLowerCase();
  const name = text_(filters.hoTen).toLowerCase();
  const requestedClass = text_(filters.className || filters.lop).toLowerCase();
  if (requestedClass && !identity.permissions.includes('students.read.all') &&
      requestedClass !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được tra cứu lớp chủ nhiệm.');
  }
  const students = sheetRows_('HS').slice(1);
  const classes = new Set(students.map(row => text_(row[1]).toLowerCase()).filter(Boolean));
  if (requestedClass && !classes.has(requestedClass)) {
    return { success: false, error: 'Lớp cần tra cứu không tồn tại trong sheet HS.' };
  }
  const types = values[0].slice(4);
  const data = values.slice(1).map((row, index) => {
    const date = formatSheetDate_(row[1]);
    const parsedDate = parseApiDate_(date);
    return {
      rowIndex: index + 2, maHS: text_(row[0]), date: date,
      class: text_(row[2]), student: text_(row[3]),
      errors: types.filter((label, typeIndex) => label && Number(row[typeIndex + 4]) > 0).map(text_)
    };
  }).filter(item => item.maHS && item.student)
    .filter(item => identity.permissions.includes('students.read.all') ||
      item.class.toLowerCase() === identity.homeroom.toLowerCase())
    .filter(item => !code || item.maHS.toLowerCase().includes(code))
    .filter(item => !name || item.student.toLowerCase().includes(name))
    .filter(item => !requestedClass || item.class.toLowerCase() === requestedClass)
    .filter(item => {
      const date = parseApiDate_(item.date);
      return (!fromDate || (date && date >= fromDate)) && (!toDate || (date && date <= toDate));
    }).map(item => Object.assign({}, item, { ngay: item.date, lop: item.class, hoTen: item.student }));
  return { success: true, data: data };
}

function saveViolation_(identity, data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const studentsSheet = ss.getSheetByName('HS');
  const targetSheet = ss.getSheetByName('dataHS');
  if (!studentsSheet || !targetSheet) return { success: false, error: 'Thiếu sheet HS hoặc dataHS.' };
  const code = text_(data.maHS);
  const student = studentsSheet.getDataRange().getValues().slice(1)
    .find(row => text_(row[0]) === code);
  if (!student) return { success: false, error: 'Không tìm thấy học sinh trong sheet HS.' };
  const className = text_(student[1]);
  if (!identity.permissions.includes('students.write.all') &&
      className.toLowerCase() !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được ghi nhận học sinh thuộc lớp chủ nhiệm.');
  }
  const header = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];
  const validTypes = header.slice(4).filter(Boolean).map(text_);
  const selected = Array.isArray(data.selectedErrors) ? data.selectedErrors.map(text_) : [];
  if (!selected.length || selected.some(error => !validTypes.includes(error))) {
    return { success: false, error: 'Danh sách lỗi vi phạm không hợp lệ theo tiêu đề sheet dataHS.' };
  }
  const date = parseApiDate_(data.ngay);
  if (!date) return { success: false, error: 'Ngày vi phạm không hợp lệ.' };
  const row = [code, date, className, text_(student[2])];
  validTypes.forEach(type => row.push(selected.includes(type) ? 1 : ''));
  targetSheet.appendRow(row);
  SpreadsheetApp.flush();
  return { success: true, message: 'Đã lưu ghi nhận vi phạm.' };
}

function getDiscipline_(identity) {
  return sheetRows_('NeNep').slice(1)
    .filter(row => row[1] && (identity.permissions.includes('students.read.all') ||
      text_(row[2]).toLowerCase() === identity.homeroom.toLowerCase()))
    .map(row => ({
      date: formatSheetDate_(row[0]), studentCode: text_(row[1]), class: text_(row[2]),
      student: text_(row[3]), content: text_(row[4]), points: Number(row[5]) || 0,
      recorder: text_(row[6])
    }));
}

function saveDiscipline_(identity, data) {
  const className = text_(data.class);
  const studentName = text_(data.student);
  const students = sheetRows_('HS').slice(1).filter(row =>
    text_(row[1]).toLowerCase() === className.toLowerCase() &&
    text_(row[2]).toLowerCase() === studentName.toLowerCase());
  if (students.length !== 1) {
    return { success: false, error: 'Không tìm thấy duy nhất một học sinh phù hợp trong sheet HS.' };
  }
  if (!identity.permissions.includes('students.write.all') &&
      className.toLowerCase() !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được ghi nhận học sinh thuộc lớp chủ nhiệm.');
  }
  const content = text_(data.content);
  const points = Number(data.points);
  if (!content || content.length > 1000 || !Number.isFinite(points) || Math.abs(points) > 100) {
    return { success: false, error: 'Nội dung hoặc điểm nề nếp chưa hợp lệ.' };
  }
  const sheet = getSheetOrCreate_('NeNep', ['Ngày', 'Mã HS', 'Lớp', 'Họ tên', 'Nội dung', 'Điểm', 'Người ghi nhận']);
  sheet.appendRow([new Date(), text_(students[0][0]), className, studentName, content, points, identity.name]);
  SpreadsheetApp.flush();
  return { success: true, message: 'Đã lưu ghi nhận nề nếp.' };
}

function getEquipment_(identity) {
  return sheetRows_('ThietBi').slice(1)
    .filter(row => row[0] && (identity.permissions.includes('leave.read.all') ||
      text_(row[1]).toUpperCase() === identity.code.toUpperCase()))
    .map(row => ({
      id: text_(row[0]), teacherCode: text_(row[1]), teacherName: text_(row[2]),
      item: text_(row[3]), period: text_(row[4]), date: formatSheetDate_(row[5]),
      status: text_(row[6])
    }));
}

function createEquipmentBorrow_(identity, data) {
  const item = text_(data.item);
  const period = text_(data.period);
  const date = parseApiDate_(data.date);
  if (!item || item.length > 200 || !period || period.length > 200 || !date) {
    return { success: false, error: 'Thông tin thiết bị mượn chưa hợp lệ.' };
  }
  const sheet = getSheetOrCreate_('ThietBi', ['Mã mượn', 'Mã GV', 'Tên GV', 'Thiết bị', 'Tiết/Lớp', 'Ngày mượn', 'Trạng thái']);
  const id = 'TB-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sheet.appendRow([id, identity.code, identity.name, item, period, date, 'Đang mượn']);
  SpreadsheetApp.flush();
  return { success: true, id: id, message: 'Đã ghi nhận mượn thiết bị.' };
}

function returnEquipment_(identity, id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('ThietBi');
  if (!sheet) return { success: false, error: 'Thiếu sheet ThietBi.' };
  const rows = sheet.getDataRange().getValues();
  for (let index = 1; index < rows.length; index++) {
    if (text_(rows[index][0]) !== text_(id)) continue;
    if (!identity.permissions.includes('leave.read.all') &&
        text_(rows[index][1]).toUpperCase() !== identity.code.toUpperCase()) {
      throw new Error('Bạn không có quyền cập nhật lượt mượn này.');
    }
    if (text_(rows[index][6]) === 'Đã trả') return { success: true, message: 'Thiết bị đã được trả trước đó.' };
    sheet.getRange(index + 1, 7).setValue('Đã trả');
    SpreadsheetApp.flush();
    return { success: true, message: 'Đã xác nhận trả thiết bị.' };
  }
  return { success: false, error: 'Không tìm thấy lượt mượn thiết bị.' };
}

function getActionPlan_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('KeHoach');
  const rows = sheet && sheet.getLastRow() > 1 ? sheet.getDataRange().getValues().slice(1) : [];
  const plans = rows.filter(row => row[0]).map(row => ({
    id: text_(row[0]), type: text_(row[1]), weekNum: Number(row[2]) || 0,
    title: text_(row[3]), fileName: text_(row[4]), hasFile: Boolean(row[5]),
    updatedAt: row[6] ? formatSheetDateTime_(row[6]) : '--'
  }));
  return {
    success: true,
    months: plans.filter(plan => plan.type === 'month'),
    weeks: plans.filter(plan => plan.type === 'week')
  };
}

function getActionPlanFile_(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('KeHoach');
  if (!sheet) return { success: false, error: 'Thiếu sheet KeHoach.' };
  const row = sheet.getDataRange().getValues().slice(1)
    .find(item => text_(item[0]) === text_(data.id) && text_(item[1]) === text_(data.type));
  if (!row || !row[5]) return { success: false, error: 'Không tìm thấy tệp kế hoạch.' };
  const blob = DriveApp.getFileById(String(row[5])).getBlob();
  return {
    success: true, fileName: text_(row[4]) || blob.getName(),
    contentType: 'application/pdf', fileData: Utilities.base64Encode(blob.getBytes())
  };
}

function uploadActionPlan_(data) {
  const type = text_(data.type);
  const id = text_(data.id);
  const fileName = text_(data.fileName);
  const base64 = text_(data.fileData).replace(/^data:application\/pdf;base64,/i, '');
  const maxBase64Length = Math.ceil((8 * 1024 * 1024) / 3) * 4;
  if (!['month', 'week'].includes(type) || !id || !fileName.toLowerCase().endsWith('.pdf') ||
      !base64 || base64.length > maxBase64Length) {
    return { success: false, error: 'Chỉ nhận tệp PDF hợp lệ dưới 8 MB cho một dòng kế hoạch có sẵn.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('KeHoach');
  if (!sheet) return { success: false, error: 'Thiếu sheet KeHoach hoặc chưa khai báo các mục kế hoạch.' };
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((row, rowIndex) => rowIndex > 0 &&
    text_(row[0]) === id && text_(row[1]) === type);
  if (index < 1) return { success: false, error: 'Không tìm thấy mục kế hoạch trong sheet KeHoach.' };

  const bytes = Utilities.base64Decode(base64);
  if (bytes.length < 5 || bytes.length > 8 * 1024 * 1024 ||
      bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { success: false, error: 'Nội dung tải lên không phải PDF hợp lệ hoặc vượt quá 8 MB.' };
  }
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const file = DriveApp.createFile(Utilities.newBlob(bytes, 'application/pdf', safeName));
  const previousId = text_(rows[index][5]);
  sheet.getRange(index + 1, 5, 1, 3).setValues([[safeName, file.getId(), new Date()]]);
  if (previousId) DriveApp.getFileById(previousId).setTrashed(true);
  SpreadsheetApp.flush();
  return { success: true, fileId: file.getId(), message: 'Đã tải tệp kế hoạch lên Drive và cập nhật sheet KeHoach.' };
}