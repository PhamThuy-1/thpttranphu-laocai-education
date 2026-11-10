const SPREADSHEET_ID = '1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';
const API_READ_ACTIONS_ = ['getInitialData', 'getData', 'getStudentViolations', 'getDiscipline', 'getActionPlan', 'getActionPlanFile', 'LayLichDayTheoNgay', 'getSubstituteSuggestions','GoiYDayBu','downloadKpiEvidence','analyzeStudentAI'];
let cachedSS_ = null;
function getSS_() {
  if (!cachedSS_) {
    cachedSS_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return cachedSS_;
}
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
        result = submitProof(identity, data);
        break;
      case 'downloadKpiEvidence':
        result = downloadKpiEvidence_(identity, data.fileId);
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
      case 'bulkAssignTask':
        result = bulkAssignTask_(identity, data);
        break;
      case 'createTask':
      case 'addNewTask':
        result = addNewTask(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score ?? data.dinhMuc, data.deadline || data.hanChot, data.quota ?? data.chiTieu, data.creatorName || identity.name);
        break;
      case 'updateTask':
        result = updateTask_(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score ?? data.dinhMuc, data.deadline || data.hanChot, data.quota ?? data.chiTieu);
        break;
      case 'deleteTask':
        result = deleteTask_(data.taskId || data.maViec);
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
      case 'getActionPlan':
        result = getActionPlan_();
        break;
      case 'getActionPlanFile':
        result = getActionPlanFile_(data);
        break;
      case 'LayLichDayTheoNgay':
        result = { success: true, schedules: LayLichDayTheoNgay(identity.code, data.dateStr) };
        break;
      case 'GoiYDayBu':
        result = {
          success: true,
          suggestion: GoiYDayBu(data.teacherACode, data.teacherBName, data.leaveDate, data.targetClass,data.targetSubject)
        };
        break;
      case 'getSubstituteSuggestions':
        var sugRes = GoiYDayThayThongMinh(data.leaveDate, data.periodTKB, data.session, data.class, data.subject,data.ticketId);
        result = {
          success: true,
          group1: sugRes.group1 || [],
          group2: sugRes.group2 || [],
          busySubList: sugRes.busySubList || []
        };
        break;
        case 'analyzeStudentAI':
        result = analyzeStudentViolationsAI_(identity, data);
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
  const cache = CacheService.getScriptCache();
  const cacheKey = 'AUTH_TOKEN_' + idToken.slice(-45);
  const cachedIdentity = cache.get(cacheKey);
  if (cachedIdentity) {
    return JSON.parse(cachedIdentity);
  }
  const clientId = "575102440654-fvv1hcq0p7buoh4ov3rgjk4p56o2d3bk.apps.googleusercontent.com";
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
  const sheet = getSS_().getSheetByName('Nhân sự');
  if (!email || !sheet) throw new Error('Thiếu email hoặc sheet Nhân sự.');
  const rows = sheet.getDataRange().getValues();
  const staff = rows.slice(2).find(row => String(row[2] || '').trim().toLowerCase() === email);
  if (!staff || !staff[0]) throw new Error('Tài khoản không có trong sheet Nhân sự.');
  const sourceRole = String(staff[5] || 'GV').trim();
  const normalizedRole = sourceRole.toUpperCase();
  const isBgh = normalizedRole.includes('BGH') || normalizedRole.includes('HIỆU TRƯỞNG') ||
    normalizedRole.includes('PHT') || normalizedRole.includes('PHÓ HIỆU TRƯỞNG');
  const role = isBgh ? 'BGH' : sourceRole;
  const isTtcm = normalizedRole.includes('TTCM') || normalizedRole.includes('TỔ TRƯỞNG') || normalizedRole === 'TT';
  const homeroom = String(staff[6] || '').trim();
  const permissions = ['kpi.read.self', 'kpi.register', 'leave.read', 'leave.create', 'equipment.read', 'equipment.write', 'plan.read', 'students.read.class'];
  if (isBgh) permissions.push('kpi.read.all', 'kpi.manage', 'leave.read.all', 'leave.assign', 'leave.approve', 'students.read.all', 'students.write.all', 'plan.write');
  if (isTtcm) permissions.push('leave.read.department', 'leave.assign');
  if (homeroom) permissions.push('students.read.class', 'students.write.class');
  const identity = {
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
  cache.put(cacheKey, JSON.stringify(identity), 1200);
  return identity;
}
function authorizeAction_(identity, action) {
  const permissions = identity.permissions || [];
  const isBgh = permissions.includes('students.read.all') || identity.role === 'BGH';
  if (isBgh && ['getStudentViolations', 'saveViolation', 'getDiscipline', 'saveDiscipline'].includes(action)) {
    return;
  }
  const required = {
    getInitialData: 'kpi.read.self', getData: 'kpi.read.self',
    submitEvidence: 'kpi.register', submitProof: 'kpi.register',
    gradeKPI: 'kpi.manage', gradeTask: 'kpi.manage',
    registerKPI: 'kpi.register', registerTask: 'kpi.register',
    assignTask: 'kpi.manage', bulkAssignTask: 'kpi.manage',
    createTask: 'kpi.manage', addNewTask: 'kpi.manage',
    updateTask: 'kpi.manage', deleteTask: 'kpi.manage',
    getStudentViolations: 'students.read.class', saveViolation: 'students.write.class',
    getDiscipline: 'students.read.class', saveDiscipline: 'students.write.class',
    createLeaveRequest: 'leave.create', updateLeaveStatus: 'leave.assign',
    getEquipment: 'equipment.read', createEquipmentBorrow: 'equipment.write',
    returnEquipment: 'equipment.write', getActionPlan: 'plan.read',
    getActionPlanFile: 'plan.read', uploadActionPlan: 'plan.write',
    LayLichDayTheoNgay: 'leave.create',
    getSubstituteSuggestions: 'leave.create',
    downloadKpiEvidence: 'kpi.read.self',
    GoiYDayBu: 'leave.assign',
    analyzeStudentAI: 'students.read.class'
  };
  const permission = required[action];
  if (!permission || permissions.indexOf(permission) === -1) {
    throw new Error('Bạn không có quyền thực hiện thao tác này.');
  }
  if (action === 'getDiscipline' && !isBgh && !identity.homeroom) {
    throw new Error('Tài khoản chưa được phân công lớp chủ nhiệm.');
  }
}
function text_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}
function sheetRows_(sheetName) {
  const sheet = getSS_().getSheetByName(sheetName);
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
          status: text_(rawKho[i][6]) || 'Còn việc',
          creatorName: text_(rawKho[i][7]) || "Ban Giám Hiệu"
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
    monthPlans: actionPlans.months,
    weekPlans: actionPlans.weeks
  };
}
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
  sheetData.appendRow([String(maViec).trim().toUpperCase(), String(maGV).trim().toUpperCase(), tenGV || '', "Đang thực hiện", taskDinhMuc, "", ""]);
  if (taskChiTieu > 0 && count + 1 >= taskChiTieu && taskRow > 0 && sheetKho) {
    sheetKho.getRange(taskRow, 7).setValue('Hết việc');
  }
  SpreadsheetApp.flush();
  return { success: true, message: "Đã giao/đăng ký việc thành công và lưu vào sheet data!" };
}
function getKpiEvidenceFolder_() {
  const folderName = 'Minh_Chung_KPI';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}
function submitProof(identity, data) {
  const ss = getSS_();
  const sheetData = ss.getSheetByName('data');
  const maGV = text_(identity.code);
  const maViec = text_(data.taskId || data.maViec).toUpperCase();
  if (!sheetData || !maGV || !maViec) {
    return { success: false, error: 'Thiếu thông tin mã giáo viên hoặc mã nhiệm vụ.' };
  }
  const rawData = sheetData.getDataRange().getValues();
  let targetRow = -1;
  let oldEvidence = '';
  let tenGV = text_(identity.name);
  for (let i = 1; i < rawData.length; i++) {
    if (String(rawData[i][0]).trim().toUpperCase() === maViec &&
        String(rawData[i][1]).trim().toUpperCase() === maGV.toUpperCase()) {
      targetRow = i + 1;
      if (!tenGV && rawData[i][2]) tenGV = String(rawData[i][2]).trim();
      oldEvidence = String(rawData[i][6] || '').trim();
      break;
    }
  }
  if (targetRow === -1) {
    return { success: false, error: 'Không tìm thấy nhiệm vụ trong danh sách phân công.' };
  }
  let evidenceValue = oldEvidence;
  if (data.fileData && data.fileName) {
    const base64 = String(data.fileData).split(',').pop();
    const maxBase64Length = Math.ceil((10 * 1024 * 1024) / 3) * 4; // Giới hạn 10MB
    if (base64.length > maxBase64Length) {
      return { success: false, error: 'Dung lượng tệp vượt quá giới hạn 10MB.' };
    }
    const originalFileName = String(data.fileName).trim();
    const lastDotIndex = originalFileName.lastIndexOf('.');
    const ext = (lastDotIndex !== -1) ? originalFileName.substring(lastDotIndex).toLowerCase() : '';
    const cleanTeacherName = (tenGV || maGV).replace(/[\\/:*?"<>|]/g, '').trim();
    const cleanTaskId = maViec.replace(/[\\/:*?"<>|]/g, '').trim();
    const standardizedFileName = `${cleanTaskId}_${cleanTeacherName}${ext}`;
    const bytes = Utilities.base64Decode(base64);
    const mimeType = text_(data.mimeType) || 'application/octet-stream';
    const blob = Utilities.newBlob(bytes, mimeType, standardizedFileName);
    const folder = getKpiEvidenceFolder_();
    const newFile = folder.createFile(blob);
    if (oldEvidence.startsWith('FILE:')) {
      const oldFileId = oldEvidence.slice(5).split('|')[0];
      if (oldFileId) {
        try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (e) {}
      }
    }
    evidenceValue = `FILE:${newFile.getId()}|${standardizedFileName}`;
  }
  sheetData.getRange(targetRow, 4).setValue('Chờ nghiệm thu');
  if (evidenceValue) {
    sheetData.getRange(targetRow, 7).setValue(evidenceValue);
  }
  SpreadsheetApp.flush();
  return {
    success: true,
    evidenceValue: evidenceValue,
    message: 'Đã lưu báo cáo hoàn thành và tệp minh chứng!'
  };
}
function downloadKpiEvidence_(identity, fileId) {
  const cleanId = text_(fileId);
  if (!cleanId) throw new Error('Thiếu mã tệp minh chứng.');
  const sheetData = getSS_().getSheetByName('data');
  if (!sheetData) throw new Error('Thiếu sheet data.');
  const rows = sheetData.getDataRange().getValues();
  const matchedRow = rows.slice(1).find(r => String(r[6] || '').includes(cleanId));
  if (!matchedRow) throw new Error('Không tìm thấy bản ghi minh chứng này.');
  const isOwner = text_(matchedRow[1]).toUpperCase() === identity.code.toUpperCase();
  const isBgh = identity.role === 'BGH' || (identity.permissions && identity.permissions.includes('kpi.manage'));
  if (!isOwner && !isBgh) {
    throw new Error('Bạn không có quyền tải tệp minh chứng của giáo viên khác.');
  }

  const evidenceCell = String(matchedRow[6] || '');
  const originalName = evidenceCell.includes('|') ? evidenceCell.split('|')[1] : '';

  const file = DriveApp.getFileById(cleanId);
  const blob = file.getBlob();

  return {
    success: true,
    fileName: originalName || file.getName(),
    contentType: blob.getContentType() || 'application/octet-stream',
    fileData: Utilities.base64Encode(blob.getBytes())
  };
}
// 5. THÊM VIỆC MỚI VÀO KHO KPI
function addNewTask(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu, nguoiGiao) {
  const ss = getSS_();
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet Kho KPI" };

  const id = text_(maViec).toUpperCase();
  const title = text_(tenViec);
  const score = Number(dinhMuc);
  const quota = Number(chiTieu);
  const deadline = text_(hanChot);
  const creator = text_(nguoiGiao) || 'Ban Giám Hiệu';

  if (!id || !title || !Number.isFinite(score) || score < 0 || !Number.isInteger(quota) || quota < 1) {
    return { success: false, error: 'Thông tin nhiệm vụ chưa hợp lệ.' };
  }
  if (deadline && !parseApiDate_(deadline)) return { success: false, error: 'Hạn hoàn thành không hợp lệ.' };
  if (sheetKho.getDataRange().getValues().some(row => text_(row[0]).toUpperCase() === id)) {
    return { success: false, error: 'Mã việc đã tồn tại trong Kho KPI.' };
  }
  sheetKho.appendRow([id, title, text_(moTa), score, parseApiDate_(deadline) || '', quota, 'Còn việc', creator]);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}
// 5B. CẬP NHẬT NHIỆM VỤ TRONG KHO KPI & ĐỒNG BỘ SANG SHEET DATA
function updateTask_(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const ss = getSS_();
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const sheetData = ss.getSheetByName('data');
  if (!sheetKho) return { success: false, error: 'Thiếu sheet Kho KPI.' };

  const id = text_(maViec).toUpperCase();
  const title = text_(tenViec);
  const desc = text_(moTa);
  const score = Number(dinhMuc);
  const quota = Number(chiTieu);
  const deadlineStr = text_(hanChot);
  const parsedDeadline = deadlineStr ? parseApiDate_(deadlineStr) : null;

  if (!id || !title || !Number.isFinite(score) || score < 0 || !Number.isInteger(quota) || quota < 1) {
    return { success: false, error: 'Thông tin nhiệm vụ cập nhật chưa hợp lệ.' };
  }
  if (deadlineStr && !parsedDeadline) {
    return { success: false, error: 'Hạn hoàn thành không hợp lệ.' };
  }
  let registeredCount = 0;
  if (sheetData && sheetData.getLastRow() >= 2) {
    const rawData = sheetData.getDataRange().getValues();
    for (let i = 1; i < rawData.length; i++) {
      if (text_(rawData[i][0]).toUpperCase() === id) {
        registeredCount++;
        if (Number(rawData[i][4]) !== score) {
          sheetData.getRange(i + 1, 5).setValue(score);
        }
      }
    }
  }

  // Tự động tính lại Trạng thái (Cột G) dựa trên chỉ tiêu mới
  const newStatus = (registeredCount >= quota) ? 'Hết việc' : 'Còn việc';
  // 2. Tìm dòng có Mã việc trùng khớp trong sheet "kho KPI"
  const rawKho = sheetKho.getDataRange().getValues();
  let foundRow = -1;
  for (let i = 0; i < rawKho.length; i++) {
    if (text_(rawKho[i][0]).toUpperCase() === id) {
      foundRow = i + 1;
      break;
    }
  }

  if (foundRow === -1) {
    return { success: false, error: 'Không tìm thấy mã nhiệm vụ [' + id + '] trong Kho KPI.' };
  }
  sheetKho.getRange(foundRow, 2, 1, 6).setValues([[
    title,
    desc,
    score,
    parsedDeadline || '',
    quota,
    newStatus
  ]]);

  SpreadsheetApp.flush();
  return { success: true, message: 'Đã cập nhật nhiệm vụ [' + id + '] thành công!' };
}

// 5C. XÓA NHIỆM VỤ TRONG KHO KPI & DỌN DẸP LƯỢT GIAO TRONG SHEET DATA
function deleteTask_(maViec) {
  const ss = getSS_();
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const sheetData = ss.getSheetByName('data');
  if (!sheetKho) return { success: false, error: 'Thiếu sheet Kho KPI.' };

  const id = text_(maViec).toUpperCase();
  if (!id) return { success: false, error: 'Thiếu mã việc cần xóa.' };

  // 1. Xóa dòng trong sheet "kho KPI" (Quét ngược từ dưới lên để không bị lệch chỉ số dòng)
  const rawKho = sheetKho.getDataRange().getValues();
  let deletedInKho = 0;
  for (let i = rawKho.length - 1; i >= 0; i--) {
    if (text_(rawKho[i][0]).toUpperCase() === id) {
      sheetKho.deleteRow(i + 1);
      deletedInKho++;
    }
  }

  if (deletedInKho === 0) {
    return { success: false, error: 'Không tìm thấy nhiệm vụ [' + id + '] trong Kho KPI.' };
  }

  // 2. Xóa các lượt giáo viên đã đăng ký nhiệm vụ này bên sheet "data" (Quét ngược từ dưới lên)
  if (sheetData && sheetData.getLastRow() >= 2) {
    const rawData = sheetData.getDataRange().getValues();
    for (let j = rawData.length - 1; j >= 1; j--) {
      if (text_(rawData[j][0]).toUpperCase() === id) {
        sheetData.deleteRow(j + 1);
      }
    }
  }

  SpreadsheetApp.flush();
  return { success: true, message: 'Đã xóa nhiệm vụ [' + id + '] và các lượt phân công liên quan!' };
}
function assignTask_(identity, data) {
  if (!identity.permissions.includes('kpi.manage')) throw new Error('Chỉ BGH mới được giao KPI.');
  const code = text_(data.teacherCode || data.maGV).toUpperCase();
  const staff = sheetRows_('Nhân sự').slice(2).find(row => text_(row[0]).toUpperCase() === code);
  if (!staff) return { success: false, error: 'Không tìm thấy giáo viên trong sheet Nhân sự.' };
  return registerTask(code, data.taskId || data.maViec, text_(staff[1]));
}

// HÀM MỚI: GIAO VIỆC HÀNG LOẠT TRONG 1 LẦN GHI DUY NHẤT
function bulkAssignTask_(identity, data) {
  if (!identity.permissions.includes('kpi.manage')) throw new Error('Chỉ BGH mới được giao KPI.');
  const taskId = text_(data.taskId || data.maViec).toUpperCase();
  const teacherCodes = Array.isArray(data.teacherCodes) ? data.teacherCodes.map(c => text_(c).toUpperCase()) : [];
  if (!taskId || teacherCodes.length === 0) {
    return { success: false, error: 'Thiếu mã việc hoặc danh sách giáo viên.' };
  }

  const ss = getSS_();
  const sheetData = ss.getSheetByName('data');
  const sheetKho = ss.getSheetByName('Kho KPI') || ss.getSheetByName('kho KPI');
  const sheetNS = ss.getSheetByName('Nhân sự');
  if (!sheetData || !sheetKho || !sheetNS) return { success: false, error: 'Thiếu sheet dữ liệu.' };

  // Lấy thông tin việc
  const rawKho = sheetKho.getDataRange().getValues();
  let taskDinhMuc = 0, taskChiTieu = 0, taskRow = -1;
  for (let i = 0; i < rawKho.length; i++) {
    if (text_(rawKho[i][0]).toUpperCase() === taskId) {
      taskDinhMuc = Number(rawKho[i][3]) || 0;
      taskChiTieu = Number(rawKho[i][5]) || 0;
      taskRow = i + 1;
      break;
    }
  }
  if (taskRow < 0) return { success: false, error: 'Không tìm thấy nhiệm vụ trong Kho KPI.' };

  // Map tên giáo viên
  const staffMap = {};
  sheetNS.getDataRange().getValues().slice(2).forEach(r => {
    if (r[0]) staffMap[text_(r[0]).toUpperCase()] = text_(r[1]);
  });
  const rawData = sheetData.getDataRange().getValues();
  let currentCount = 0;
  const existingTeachers = new Set();
  for (let i = 1; i < rawData.length; i++) {
    if (text_(rawData[i][0]).toUpperCase() === taskId) {
      currentCount++;
      existingTeachers.add(text_(rawData[i][1]).toUpperCase());
    }
  }
  const newRows = [];
  const assignedList = [];
  for (const code of teacherCodes) {
    if (!existingTeachers.has(code) && staffMap[code]) {
      if (taskChiTieu > 0 && (currentCount + newRows.length) >= taskChiTieu) break;
      newRows.push([taskId, code, staffMap[code], "Đang thực hiện", taskDinhMuc, "", ""]);
      assignedList.push({ teacherCode: code, teacherName: staffMap[code], baseScore: taskDinhMuc });
      existingTeachers.add(code);
    }
  }
  if (newRows.length > 0) {
    sheetData.getRange(sheetData.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);
  }
  const isNowFull = taskChiTieu > 0 && (currentCount + newRows.length) >= taskChiTieu;
  if (isNowFull) {
    sheetKho.getRange(taskRow, 7).setValue('Hết việc');
  }
  return {
    success: true,
    assignedList: assignedList,
    isNowFull: isNowFull,
    message: `Đã giao thành công cho ${newRows.length} giáo viên.`
  };
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
      status: text_(row[17]) || 'PENDING_TTCM', periods: []
    });
    ticket.periods.push({
      rowIndex: index + 2, leaveDate: formatSheetDate_(row[8]), dayOfWeek: '',
      session: text_(row[9]), class: text_(row[10]), periodTKB: row[11],
      periodPPCT: row[12], lessonName: text_(row[13]), subTeacher: text_(row[14]),
      subSubject: text_(row[15]) || '',
      makeupSchedule: text_(row[16]) || 'Chưa dạy bù',
      subject: text_(row[3])
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
  if (!ticket || !Array.isArray(ticket.periods) || ticket.periods.length === 0) {
    throw new Error('Dữ liệu đơn xin nghỉ hoặc danh sách tiết nghỉ không hợp lệ.');
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName("LichNghi");
  if (!sheet) {
    throw new Error("Không tìm thấy sheet LichNghi trên bảng tính.");
  }
  const lastRow = sheet.getLastRow();
  let maxIndex = 0;

  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    ids.forEach(row => {
      const idStr = String(row[0] || '').trim();
      const match = idStr.match(/^DN-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxIndex) maxIndex = num;
      }
    });
  }
  const nextIndex = maxIndex + 1;
  const newId = "DN-" + String(nextIndex).padStart(3, '0');
  const rowsToAppend = [];
  const teacherCode = identity.code;
  const teacherName = identity.name;
  const subject = identity.subject;
  const department = identity.department;
  const reasonCategory = text_(ticket.reasonCategory || 'Việc riêng');
  const reasonDetail = text_(ticket.reason || '');
  ticket.periods.forEach(p => {
    const leaveDate = parseApiDate_(p.leaveDate || p.rawDate);
    const dateFormatted = formatSheetDate_(leaveDate) || text_(p.leaveDate);
    rowsToAppend.push([
      newId,
      teacherCode,
      teacherName,
      text_(p.subject || subject),
      department,
      reasonCategory,
      reasonDetail,
      new Date(),
      dateFormatted,
      text_(p.session || 'Sáng'),
      text_(p.class),
      Number(p.periodTKB) || 1,
      Number(p.periodPPCT) || 1,
      text_(p.lessonName),
      '',
      '',
      'Chưa dạy bù',
      'PENDING_TTCM',
      new Date()
    ]);
  });
  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }
  SpreadsheetApp.flush();
  return {
    success: true,
    id: newId
  };
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
  const currentStatuses = new Set(matches.map(match => text_(match.row[17])));
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
      sheet.getRange(matches[index].index, 15, 1, 3).setValues([[
        text_(period.subTeacher).slice(0, 100),
        text_(period.subSubject || '').slice(0, 50),
        text_(period.makeupSchedule || 'Chưa dạy bù').slice(0, 200)
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
    sheet.getRange(match.index, 18).setValue(status);
    sheet.getRange(match.index, 19).setValue(new Date());
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
  const isBgh = identity.permissions.includes('students.read.all') || identity.role === 'BGH';
  if (!isBgh && requestedClass && requestedClass !== identity.homeroom.toLowerCase()) {
    throw new Error('Bạn chỉ được tra cứu lớp chủ nhiệm.');
  }
  const types = values[0].slice(4);
  const data = values.slice(1).map((row, index) => {
    const date = formatSheetDate_(row[1]);
    return {
      rowIndex: index + 2, maHS: text_(row[0]), date: date,
      class: text_(row[2]), student: text_(row[3]),
      errors: types.filter((label, typeIndex) => label && Number(row[typeIndex + 4]) > 0).map(text_)
    };
  }).filter(item => item.maHS && item.student)
    .filter(item => isBgh || item.class.toLowerCase() === identity.homeroom.toLowerCase())
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
  const base64 = text_(data.fileData).split(',').pop();
  const maxBase64Length = Math.ceil((5 * 1024 * 1024) / 3) * 4;
  if (!['month', 'week'].includes(type) || !id || !fileName.toLowerCase().endsWith('.pdf') ||
      !base64 || base64.length > maxBase64Length) {
    return { success: false, error: 'Chỉ nhận tệp PDF hợp lệ dưới 5 MB.' };
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('KeHoach');
  if (!sheet) return { success: false, error: 'Thiếu sheet KeHoach.' };
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { success: false, error: 'Nội dung tải lên không phải định dạng PDF chuẩn.' };
  }
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const file = DriveApp.createFile(Utilities.newBlob(bytes, 'application/pdf', safeName));
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((row, rowIndex) => rowIndex > 0 && text_(row[0]) === id && text_(row[1]) === type);
  if (index < 1) {
    const title = text_(data.title) || (type === 'month' ? 'Kế hoạch tháng' : 'Kế hoạch tuần');
    const weekNum = type === 'week' ? parseInt(id.replace(/\D/g, '')) || 0 : 0;
    sheet.appendRow([id, type, weekNum, title, safeName, file.getId(), new Date()]);
  } else {
    const previousId = text_(rows[index][5]);
    sheet.getRange(index + 1, 5, 1, 3).setValues([[safeName, file.getId(), new Date()]]);
    if (previousId) {
      try { DriveApp.getFileById(previousId).setTrashed(true); } catch(e) {}
    }
  }
  SpreadsheetApp.flush();
  return { success: true, fileId: file.getId(), message: 'Đã lưu tệp kế hoạch thành công.' };
}
function LayLichDayTheoNgay(teacherCode, dateStr) {
  var ss = getSS_();
  var sheetTKB = ss.getSheetByName("TKB");
  if (!sheetTKB) return [];
  var parts = dateStr.includes("-") ? dateStr.split("-") : dateStr.split("/");
  var d = parts[0].length === 4 ? new Date(parts[0], parts[1]-1, parts[2]) : new Date(parts[2], parts[1]-1, parts[0]);
  var dayOfWeekNum = d.getDay();
  if (dayOfWeekNum === 0) return [];
  var targetDayNum = dayOfWeekNum + 1;
  var data = sheetTKB.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var result = [];
  var currentThu = "";
  for (var i = 1; i < data.length; i++) {
    var colA = String(data[i][0]).trim();
    var colB = String(data[i][1]).trim();
    if (colA !== "") {
      currentThu = colA;
    }
    if (parseInt(currentThu) === targetDayNum) {
      var periodNum = parseInt(colB.replace(/\D/g, "")) || 1;
      for (var j = 2; j < headers.length; j++) {
        var className = String(headers[j]).trim();
        var cellVal = String(data[i][j]).trim();
        if (!cellVal) continue;
        var lastHyphenIdx = cellVal.lastIndexOf("-");
        if (lastHyphenIdx !== -1) {
          var tCode = cellVal.substring(lastHyphenIdx + 1).trim();
          var subjectName = cellVal.substring(0, lastHyphenIdx).trim();

          if (tCode.toUpperCase() === teacherCode.toUpperCase()) {
            result.push({
              session: periodNum <= 5 ? "Sáng" : "Chiều",
              dayOfWeek: "Thứ " + targetDayNum,
              leaveDate: dateStr,
              class: className,
              periodTKB: periodNum,
              subject: subjectName,
              lessonName: ""
            });
          }
        }
      }
    }
  }
  result.sort(function(a, b) { return a.periodTKB - b.periodTKB; });
  return result;
}
function GoiYDayThayThongMinh(leaveDate, periodTKB, session, targetClass, targetSubject, currentTicketId) {
  try {
    var ss = getSS_();
    var sheetTKB = ss.getSheetByName("TKB");
    var staffSheet = ss.getSheetByName("Nhân sự") || ss.getSheetByName("staff");
    if (!sheetTKB || !staffSheet) return { group1: [], group2: [], busySubList: [] };
    function normalizeDateStr(dVal) {
      var parsed = parseApiDate_(dVal);
      if (parsed) return Utilities.formatDate(parsed, 'GMT+7', 'dd/MM/yyyy');
      return String(dVal || "").trim();
    }
    var targetDateNorm = normalizeDateStr(leaveDate);
    var targetSessionNorm = String(session || "Sáng").trim().toLowerCase();
    var targetPeriodNum = Number(periodTKB) || 1;
    var currentTicketNorm = String(currentTicketId || "").trim().toUpperCase();
    var staffData = staffSheet.getDataRange().getValues();
    var staffMap = {};
    var staffList = [];
    for (var i = 1; i < staffData.length; i++) {
      var code = String(staffData[i][0] || "").trim();
      var name = String(staffData[i][1] || "").trim();
      var subject = String(staffData[i][3] || "").trim();
      if (!name || code.toUpperCase() === "MÃ GV" || name.toUpperCase().includes("HỌ VÀ TÊN")) continue;
      var info = { name: name, code: code, subject: subject };
      staffList.push(info);
      staffMap[name.toLowerCase()] = info;
      if (code) staffMap[code.toLowerCase()] = info;
    }
    var leaveRequestsSheet = ss.getSheetByName("LichNghi") || ss.getSheetByName("leaveRequests");
    var subCounts = {};
    staffList.forEach(function(s) { subCounts[s.name] = 0; });
    var busyByLichNghi = {};
    if (leaveRequestsSheet && leaveRequestsSheet.getLastRow() > 1) {
      var leaveData = leaveRequestsSheet.getDataRange().getValues();
      for (var i = 1; i < leaveData.length; i++) {
        var rowTicketId = String(leaveData[i][0] || "").trim().toUpperCase();
        var reqTeacherCode = String(leaveData[i][1] || "").trim().toLowerCase();
        var reqTeacherName = String(leaveData[i][2] || "").trim();
        var rowDateNorm = normalizeDateStr(leaveData[i][8]);
        var rowSessionNorm = String(leaveData[i][9] || "Sáng").trim().toLowerCase();
        var rowClass = String(leaveData[i][10] || "").trim();
        var rowPeriodNum = Number(leaveData[i][11]) || 0;
        var subTeacher = String(leaveData[i][14] || "").trim();
        var rowStatus = String(leaveData[i][17] || "").trim().toUpperCase();
        if (rowStatus === "REJECTED" || rowStatus === "CANCELLED" || rowStatus === "ĐÃ HỦY") continue;
        if (subTeacher && staffMap[subTeacher.toLowerCase()]) {
          var canonicalSubName = staffMap[subTeacher.toLowerCase()].name;
          subCounts[canonicalSubName] = (subCounts[canonicalSubName] || 0) + 1;
        }
        var isSameSlot = (
          rowDateNorm === targetDateNorm &&
          rowPeriodNum === targetPeriodNum &&
          rowSessionNorm === targetSessionNorm
        );
        if (isSameSlot) {
          if (reqTeacherName && staffMap[reqTeacherName.toLowerCase()]) {
            var absentKey = staffMap[reqTeacherName.toLowerCase()].name.toLowerCase();
            busyByLichNghi[absentKey] = "Đang có đơn xin nghỉ tiết này (Lớp " + rowClass + ")";
          } else if (reqTeacherCode && staffMap[reqTeacherCode]) {
            var absentKeyByCode = staffMap[reqTeacherCode].name.toLowerCase();
            busyByLichNghi[absentKeyByCode] = "Đang có đơn xin nghỉ tiết này (Lớp " + rowClass + ")";
          }
          var isCurrentEditingSlot = (
            currentTicketNorm &&
            rowTicketId === currentTicketNorm &&
            String(rowClass).toLowerCase() === String(targetClass || "").trim().toLowerCase()
          );

          if (subTeacher && !isCurrentEditingSlot) {
            if (staffMap[subTeacher.toLowerCase()]) {
              var subKey = staffMap[subTeacher.toLowerCase()].name.toLowerCase();
              busyByLichNghi[subKey] = "Đã xếp dạy thay Lớp " + rowClass + " (Đơn " + rowTicketId + ")";
            } else {
              busyByLichNghi[subTeacher.toLowerCase()] = "Đã xếp dạy thay Lớp " + rowClass + " (Đơn " + rowTicketId + ")";
            }
          }
        }
      }
    }
    var d = parseApiDate_(leaveDate);
    if (!d) return { group1: [], group2: [], busySubList: [] };
    var dayOfWeekNum = d.getDay();
    if (isNaN(dayOfWeekNum) || dayOfWeekNum === 0) return { group1: [], group2: [], busySubList: [] };
    var targetDayNum = dayOfWeekNum + 1; // Thứ 2 = 2, ..., Thứ 7 = 7

    var tkbData = sheetTKB.getDataRange().getValues();
    var tkbHeaders = tkbData[0];

    function normalizeClassName(name) {
      return String(name || "").trim().toLowerCase().replace(/lớp/g, '').replace(/[^a-z0-9]/g, '');
    }

    var cleanTargetClass = normalizeClassName(targetClass);
    var classColIndex = -1;
    for (var j = 2; j < tkbHeaders.length; j++) {
      if (normalizeClassName(tkbHeaders[j]) === cleanTargetClass) {
        classColIndex = j;
        break;
      }
    }

    if (classColIndex === -1) {
      return { group1: [], group2: [], busySubList: [] };
    }
    var teachersTeachingThisClass = new Set();
    for (var i = 1; i < tkbData.length; i++) {
      var cellVal = String(tkbData[i][classColIndex] || "").trim();
      if (cellVal) {
        var lastHyphen = cellVal.lastIndexOf("-");
        var tCode = lastHyphen !== -1 ? cellVal.substring(lastHyphen + 1).trim().toLowerCase() : cellVal.trim().toLowerCase();
        if (staffMap[tCode]) {
          teachersTeachingThisClass.add(staffMap[tCode].name);
        }
      }
    }
    var busyOnTKB = new Set();
    var currentThu = 0;
    for (var i = 1; i < tkbData.length; i++) {
      var colA = String(tkbData[i][0] || "").trim();
      var colB = String(tkbData[i][1] || "").trim();
      if (colA !== "") {
        var matchThu = colA.replace(/\D/g, "");
        if (matchThu) currentThu = parseInt(matchThu, 10);
      }
      if (currentThu === targetDayNum) {
        var pNum = parseInt(colB.replace(/\D/g, "")) || 0;
        var rowSession = pNum <= 5 ? "sáng" : "chiều";
        var normalizedPNum = pNum > 5 ? (pNum - 5) : pNum;
        var isMatchingPeriod = (pNum === targetPeriodNum && (targetPeriodNum > 5 || rowSession === targetSessionNorm)) ||
                               (targetSessionNorm === "chiều" && pNum === (targetPeriodNum + 5)) ||
                               (rowSession === targetSessionNorm && normalizedPNum === targetPeriodNum);

        if (isMatchingPeriod) {
          for (var j = 2; j < tkbHeaders.length; j++) {
            var cellVal = String(tkbData[i][j] || "").trim();
            if (cellVal) {
              var lastHyphen = cellVal.lastIndexOf("-");
              var tCode = lastHyphen !== -1 ? cellVal.substring(lastHyphen + 1).trim().toLowerCase() : cellVal.trim().toLowerCase();
              if (staffMap[tCode]) {
                busyOnTKB.add(staffMap[tCode].name.toLowerCase());
              }
            }
          }
        }
      }
    }
    function normalizeSub(sub) {
      if (!sub) return "";
      sub = String(sub).trim().toLowerCase();
      if (sub === "lí" || sub === "lý" || sub === "vật lý" || sub === "vật lí") return "ly";
      if (sub === "toán" || sub === "toán học") return "toan";
      if (sub === "ngữ văn" || sub === "văn") return "van";
      if (sub === "tiếng anh" || sub === "anh") return "anh";
      return sub;
    }
    var group1_ClassFree = [];
    var group2_SubjectFree = [];
    var busySubList = [];
    var cleanTargetSubject = normalizeSub(targetSubject);
    staffList.forEach(function(s) {
      var nameKey = s.name.toLowerCase();
      var isFreeOnTKB = !busyOnTKB.has(nameKey);
      var lichNghiBusyReason = busyByLichNghi[nameKey];
      var sSubjectClean = normalizeSub(s.subject);
      var isSameSubject = (cleanTargetSubject && sSubjectClean === cleanTargetSubject);
      var isTeachingTargetClass = teachersTeachingThisClass.has(s.name);
      if (isFreeOnTKB && !lichNghiBusyReason) {
        var candidate = {
          name: s.name,
          subject: s.subject,
          subCount: subCounts[s.name] || 0,
          status: "FREE"
        };
        if (isTeachingTargetClass) {
          group1_ClassFree.push(candidate);
        } else if (isSameSubject) {
          group2_SubjectFree.push(candidate);
        }
      } else if (isFreeOnTKB && lichNghiBusyReason && (isTeachingTargetClass || isSameSubject)) {
        busySubList.push({
          name: s.name,
          subject: s.subject,
          subCount: subCounts[s.name] || 0,
          status: "BUSY_LICHNGHI",
          busyReason: lichNghiBusyReason
        });
      }
    });
    var sortBySubCount = function(a, b) { return a.subCount - b.subCount; };
    group1_ClassFree.sort(sortBySubCount);
    group2_SubjectFree.sort(sortBySubCount);
    return {
      group1: group1_ClassFree,
      group2: group2_SubjectFree,
      busySubList: busySubList
    };
  } catch (err) {
    Logger.log("Lỗi trong GoiYDayThayThongMinh: " + err.message);
    return { group1: [], group2: [], busySubList: [] };
  }
}
function GoiYDayBu(teacherACode, teacherBName, leaveDate, targetClass, targetSubject) {
  try {
    var ss = getSS_();
    var sheetTKB = ss.getSheetByName("TKB");
    var staffSheet = ss.getSheetByName("Nhân sự") || ss.getSheetByName("staff");
    if (!sheetTKB || !staffSheet) return "Chưa dạy bù";

    // Hàm chuẩn hóa tên môn học để so sánh chính xác (VD: "Vật lí" == "Lý")
    function normalizeSub(sub) {
      if (!sub) return "";
      sub = String(sub).trim().toLowerCase();
      if (sub === "lí" || sub === "lý" || sub === "vật lý" || sub === "vật lí") return "ly";
      if (sub === "toán" || sub === "toán học") return "toan";
      if (sub === "ngữ văn" || sub === "văn") return "van";
      if (sub === "tiếng anh" || sub === "anh" || sub === "ngoại ngữ") return "anh";
      if (sub === "hóa" || sub === "hoá" || sub === "hóa học") return "hoa";
      if (sub === "sinh" || sub === "sinh học") return "sinh";
      if (sub === "sử" || sub === "lịch sử") return "su";
      if (sub === "địa" || sub === "địa lí" || sub === "địa lý") return "dia";
      return sub;
    }

    // Hàm chuẩn hóa tên lớp
    function normalizeClassName(name) {
      return String(name || "").trim().toLowerCase().replace(/lớp/g, '').replace(/[^a-z0-9]/g, '');
    }

    // 1. Tìm mã và môn chuyên môn của GV A & GV B từ sheet Nhân sự
    var staffData = staffSheet.getDataRange().getValues();
    var teacherBCode = "";
    var teacherBSubject = "";
    var teacherASubject = "";

    for (var i = 1; i < staffData.length; i++) {
      var code = String(staffData[i][0] || "").trim();
      var name = String(staffData[i][1] || "").trim();
      var subj = String(staffData[i][3] || "").trim();

      if (name.toLowerCase() === String(teacherBName || "").trim().toLowerCase()) {
        teacherBCode = code;
        teacherBSubject = subj;
      }
      if (code.toUpperCase() === String(teacherACode || "").trim().toUpperCase()) {
        teacherASubject = subj;
      }
    }
    if (!teacherBCode) return "Chưa dạy bù";
    var cleanTargetSub = normalizeSub(targetSubject || teacherASubject || teacherBSubject);

    var tkbData = sheetTKB.getDataRange().getValues();
    var tkbHeaders = tkbData[0];

    var cleanTargetClass = normalizeClassName(targetClass);
    var targetGradeMatch = cleanTargetClass.match(/^\d+/);
    var targetGrade = targetGradeMatch ? targetGradeMatch[0] : "";

    var classColIndex = -1;
    for (var j = 2; j < tkbHeaders.length; j++) {
      if (normalizeClassName(tkbHeaders[j]) === cleanTargetClass) {
        classColIndex = j;
        break;
      }
    }
    var currentThu = "";
    var scheduleB_SameClass = [];
    var scheduleB_SameSubject = [];
    var scheduleA_busy = {};
    for (var i = 1; i < tkbData.length; i++) {
      var colA = String(tkbData[i][0] || "").trim();
      var colB = String(tkbData[i][1] || "").trim();
      if (colA !== "") {
        var matchThu = colA.replace(/\D/g, "");
        currentThu = matchThu ? matchThu : colA;
      }
      var periodNum = parseInt(colB.replace(/\D/g, "")) || 0;
      if (!currentThu || !periodNum) continue;
      for (var j = 2; j < tkbHeaders.length; j++) {
        var cellVal = String(tkbData[i][j] || "").trim();
        if (!cellVal) continue;
        var lastHyphen = cellVal.lastIndexOf("-");
        if (lastHyphen === -1) continue;
        var cellSubject = cellVal.substring(0, lastHyphen).trim();
        var tCode = cellVal.substring(lastHyphen + 1).trim();
        var classNameHeader = String(tkbHeaders[j] || "").trim();
        if (tCode.toUpperCase() === String(teacherACode || "").trim().toUpperCase()) {
          scheduleA_busy[currentThu + "_" + periodNum] = true;
        }
        if (tCode.toUpperCase() === teacherBCode.toUpperCase()) {
          if (j === classColIndex) {
            scheduleB_SameClass.push({
              thu: currentThu,
              tiet: periodNum,
              lop: classNameHeader,
              mon: cellSubject
            });
          } else {
            var isSameSub = !cleanTargetSub || (normalizeSub(cellSubject) === cleanTargetSub);
            if (isSameSub) {
              var clsNorm = normalizeClassName(classNameHeader);
              var isSameGrade = targetGrade && clsNorm.indexOf(targetGrade) === 0;
              scheduleB_SameSubject.push({
                thu: currentThu,
                tiet: periodNum,
                lop: classNameHeader,
                mon: cellSubject,
                sameGrade: isSameGrade ? 1 : 0
              });
            }
          }
        }
      }
    }
    for (var k = 0; k < scheduleB_SameClass.length; k++) {
      var slot1 = scheduleB_SameClass[k];
      var key1 = slot1.thu + "_" + slot1.tiet;
      if (!scheduleA_busy[key1]) {
        var thuDisp1 = /^\d+$/.test(String(slot1.thu)) ? ("Thứ " + slot1.thu) : slot1.thu;
        return thuDisp1 + " (Tiết " + slot1.tiet + ", Lớp " + slot1.lop + ")";
      }
    }
    scheduleB_SameSubject.sort(function(a, b) {
      if (b.sameGrade !== a.sameGrade) return b.sameGrade - a.sameGrade;
      return (parseInt(a.thu) || 0) - (parseInt(b.thu) || 0) || (a.tiet - b.tiet);
    });
    for (var m = 0; m < scheduleB_SameSubject.length; m++) {
      var slot2 = scheduleB_SameSubject[m];
      var key2 = slot2.thu + "_" + slot2.tiet;
      if (!scheduleA_busy[key2]) {
        var thuDisp2 = /^\d+$/.test(String(slot2.thu)) ? ("Thứ " + slot2.thu) : slot2.thu;
        return thuDisp2 + " (Tiết " + slot2.tiet + ", Lớp " + slot2.lop + " - Môn " + slot2.mon + ")";
      }
    }
    return "Chưa tìm thấy tiết phù hợp";
  } catch (err) {
    Logger.log("Lỗi GoiYDayBu: " + err.message);
    return "Chưa dạy bù";
  }
}
