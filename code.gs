const SPREADSHEET_ID = '1qJyIXs80N_ds-lqsKoWYLgY63l86vnPZp7UX1-6Hg54';

// Hàm phụ trợ tìm sheet không phân biệt chữ hoa / thường hay dấu cách
// Hàm phụ trợ tìm sheet không phân biệt chữ hoa / thường hay dấu cách (đã chống lỗi undefined)
function getSheetSafe(ss, sheetName) {
  if (!ss || !sheetName) return null;
  const target = String(sheetName).toLowerCase().replace(/\s+/g, '');
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().replace(/\s+/g, '') === target) {
      return sheets[i];
    }
  }
  return ss.getSheetByName(sheetName);
}

// Xử lý đọc dữ liệu (GET) & JSONP
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
    } else if (action === 'getStudentViolations') {
      result = getStudentViolations(params);
    } else {
      result = { success: false, error: 'Unknown GET action: ' + action };
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

// Xử lý ghi dữ liệu (POST)
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

    // 1. Nghiệp vụ KPI
    if (action === 'submitEvidence' || action === 'submitProof') {
      result = submitProof(data.teacherCode || data.maGV, data.taskId || data.maViec, data.evidence || data.url);
    } else if (action === 'gradeKPI' || action === 'gradeTask') {
      result = gradeTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.finalScore || data.score);
    } else if (action === 'registerKPI' || action === 'registerTask') {
      result = registerTask(data.teacherCode || data.maGV, data.taskId || data.maViec, data.teacherName || data.tenGV, data.score || data.dinhMuc);
    } else if (action === 'createTask' || action === 'addNewTask') {
      result = addNewTask(data.taskId || data.maViec, data.title || data.tenViec, data.desc || data.moTa, data.score || data.dinhMuc, data.deadline || data.hanChot, data.quota || data.chiTieu);
    }
    // 2. Nghiệp vụ Nghỉ dạy & Dạy thay (Lưu vào sheet LichNghi)
    else if (action === 'createLeaveRequest') {
      result = createLeaveRequest(data.ticket);
    } else if (action === 'updateLeaveStatus') {
      result = updateLeaveStatus(data.ticketId, data.status, data.periods);
    }
    // 3. Nghiệp vụ Quản lý nề nếp học sinh (Ghi vào dòng trống sheet dataHS)
    else if (action === 'saveViolation') {
      result = saveViolationRecord(data);
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

// 1. ĐỌC DỮ LIỆU TỔNG HỢP TOÀN BỘ CÁC SHEET
function getInitialData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. Đọc sheet kho KPI (không phân biệt hoa thường)
  const sheetKho = getSheetSafe(ss, 'kho KPI') || getSheetSafe(ss, 'Kho KPI');
  const tasks = [];
  if (sheetKho) {
    const rawKho = sheetKho.getDataRange().getValues();
    for (let i = 2; i < rawKho.length; i++) {
      if (rawKho[i][0]) {
        let dlStr = '';
        if (rawKho[i][4]) {
          dlStr = (rawKho[i][4] instanceof Date)
            ? Utilities.formatDate(rawKho[i][4], "GMT+7", "dd/MM/yyyy")
            : String(rawKho[i][4]).trim();
        }
        tasks.push({
          id: String(rawKho[i][0]).trim(),
          title: String(rawKho[i][1] || '').trim(),
          desc: String(rawKho[i][2] || '').trim(),
          score: Number(rawKho[i][3]) || 0,
          deadline: dlStr,
          quota: Number(rawKho[i][5]) || 0,
          status: String(rawKho[i][6] || 'Còn việc').trim()
        });
      }
    }
  }

  // 2. Đọc sheet data
  const sheetData = getSheetSafe(ss, 'data');
  const registrations = [];
  if (sheetData) {
    const rawData = sheetData.getDataRange().getValues();
    for (let i = 1; i < rawData.length; i++) {
      if (rawData[i][0] && (rawData[i][1] || rawData[i][2])) {
        registrations.push({
          rowIndex: i + 1,
          taskId: String(rawData[i][0]).trim(),
          teacherCode: String(rawData[i][1] || '').trim(),
          teacherName: String(rawData[i][2] || '').trim(),
          level: String(rawData[i][3] || 'Đang thực hiện').trim(),
          baseScore: Number(rawData[i][4]) || 0,
          finalScore: (rawData[i][5] !== "" && rawData[i][5] !== null && rawData[i][5] !== undefined) ? Number(rawData[i][5]) : null,
          evidence: String(rawData[i][6] || '').trim()
        });
      }
    }
  }

  // 3. Đọc sheet Nhân sự
  const sheetNS = getSheetSafe(ss, 'Nhân sự');
  const staff = [];
  if (sheetNS) {
    const rawNS = sheetNS.getDataRange().getValues();
    for (let i = 2; i < rawNS.length; i++) {
      if (rawNS[i][0]) {
        const roleStr = String(rawNS[i][5] || '').toUpperCase();
        staff.push({
          code: String(rawNS[i][0]).trim(),
          name: String(rawNS[i][1] || '').trim(),
          email: String(rawNS[i][2] || '').trim().toLowerCase(),
          subject: String(rawNS[i][3] || '').trim(),
          department: String(rawNS[i][4] || '').trim(),
          role: String(rawNS[i][5] || 'GV').trim(),
          homeroom: String(rawNS[i][6] || '').trim(),
          isTTCM: roleStr.includes('TỔ TRƯỞNG') || roleStr.includes('TTCM')
        });
      }
    }
  }
// 3.1. Đọc sheet HS (Mã HS, Lớp, Họ và tên)
  const sheetHS = getSheetSafe(ss, 'HS');
  const studentsList = [];
  if (sheetHS) {
    const rawHS = sheetHS.getDataRange().getValues();
    // Bắt đầu từ dòng 0 hoặc 1 tuỳ tiêu đề
    for (let i = 0; i < rawHS.length; i++) {
      if (rawHS[i][0] && rawHS[i][1] && rawHS[i][2]) {
        // Bỏ qua dòng tiêu đề nếu có
        if (String(rawHS[i][0]).toLowerCase().includes('mã')) continue;
        studentsList.push({
          maHS: String(rawHS[i][0]).trim(),
          lop: String(rawHS[i][1]).trim(),
          hoTen: String(rawHS[i][2]).trim()
        });
      }
    }
  }
  // 4. Đọc sheet LichNghi (Ghép từng tiết nghỉ theo Mã đơn)
  const sheetLichNghi = getSheetSafe(ss, 'LichNghi');
  const leaveRequests = [];
  if (sheetLichNghi) {
    const rawLN = sheetLichNghi.getDataRange().getValues();
    const ticketMap = {};

    for (let i = 1; i < rawLN.length; i++) {
      const row = rawLN[i];
      const ticketId = String(row[0] || '').trim();
      if (!ticketId) continue;

      if (!ticketMap[ticketId]) {
        ticketMap[ticketId] = {
          id: ticketId,
          teacherCode: String(row[1] || '').trim(),
          teacherName: String(row[2] || '').trim(),
          subject: String(row[3] || '').trim(),
          department: String(row[4] || '').trim(),
          reasonCategory: String(row[5] || 'Việc riêng').trim(),
          reason: String(row[6] || '').trim(),
          createdAt: row[7] ? (row[7] instanceof Date ? Utilities.formatDate(row[7], "GMT+7", "dd/MM/yyyy") : String(row[7])) : '',
          status: String(row[16] || 'PENDING_TTCM').trim(),
          periods: []
        };
      }

      let leaveDateFormatted = '';
      if (row[8]) {
        leaveDateFormatted = (row[8] instanceof Date)
          ? Utilities.formatDate(row[8], "GMT+7", "dd/MM/yyyy")
          : String(row[8]).trim();
      }

      ticketMap[ticketId].periods.push({
        leaveDate: leaveDateFormatted,
        session: String(row[9] || 'Sáng').trim(),
        class: String(row[10] || '').trim(),
        periodTKB: Number(row[11]) || 1,
        periodPPCT: Number(row[12]) || 1,
        lessonName: String(row[13] || '').trim(),
        subTeacher: String(row[14] || '').trim(),
        subSubject: String(row[3] || '').trim(),
        makeupSchedule: String(row[15] || '').trim()
      });
    }

    for (const tid in ticketMap) {
      const item = ticketMap[tid];
      const distinctSessions = [...new Set(item.periods.map(p => `${p.leaveDate} (${p.session})`))];
      item.timeDisplay = distinctSessions.join('; ');
      leaveRequests.push(item);
    }
  }

  return {
    success: true,
    tasks: tasks,
    registrations: registrations,
    staff: staff,
    students: studentsList, // <--- Thêm studentsList vào đây
    leaveRequests: leaveRequests
  };
}

// 2. GHI ĐƠN NGHỈ MỚI VÀO SHEET LICHNGHI (20 CỘT CHUẨN - MÃ ĐƠN TỊNH TIẾN)
function createLeaveRequest(ticket) {
  if (!ticket || !ticket.periods || ticket.periods.length === 0) {
    return { success: false, message: "Dữ liệu đơn không hợp lệ" };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheetLN = getSheetSafe(ss, 'LichNghi');
  if (!sheetLN) {
    sheetLN = ss.insertSheet('LichNghi');
    sheetLN.appendRow([
      'Mã đơn', 'Mã GV', 'Tên GV', 'Môn dạy', 'Tổ', 'Loại lý do', 'Chi tiết lý do',
      'Ngày gửi', 'Ngày nghỉ', 'Buổi', 'Lớp dạy', 'Tiết TKB', 'Tiết PPCT',
      'Tên bài dạy theo KH', 'GV dạy thay', 'Lịch lấy lại giờ (Dạy bù)',
      'Trạng thái duyệt','Ngày duyệt'
    ]);
  }

  // --- BẮT ĐẦU: TÍNH TOÁN MÃ ĐƠN TỊNH TIẾN THEO SỐ ĐƠN ĐÃ CÓ ---
  const rawLN = sheetLN.getDataRange().getValues();
  let maxTicketNum = 0;

  // Quét qua tất cả các dòng hiện có ở cột A để tìm số thứ tự lớn nhất
  for (let i = 1; i < rawLN.length; i++) {
    const ma = String(rawLN[i][0] || '').trim();
    const match = ma.match(/\d+$/); // Tìm phần số ở cuối mã (vd: NP-0005 -> 5)
    if (match) {
      const num = parseInt(match[0], 10);
      if (num > maxTicketNum) {
        maxTicketNum = num;
      }
    }
  }

  // Tịnh tiến số tiếp theo lên 1 đơn vị
  const nextNum = maxTicketNum + 1;
  // Tạo mã định dạng chuẩn 4 chữ số: NP-0001, NP-0002, NP-0003...
  const generatedTicketId = "NP-" + ("0000" + nextNum).slice(-4);
  // --- KẾT THÚC: TÍNH TOÁN MÃ ĐƠN TỊNH TIẾN ---

  const nowStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");

  // Ghi từng tiết nghỉ thành 1 dòng, dùng chung Mã đơn tịnh tiến vừa tạo
  ticket.periods.forEach(p => {
    sheetLN.appendRow([
      generatedTicketId,
      ticket.teacherCode || '',
      ticket.teacherName || '',
      ticket.subject || '',
      ticket.department || '',
      ticket.reasonCategory || 'Việc riêng',
      ticket.reason || '',
      nowStr,
      p.leaveDate || '',
      p.session || 'Sáng',
      p.class || '',
      Number(p.periodTKB) || 1,
      Number(p.periodPPCT) || 1,
      p.lessonName || '',
      p.subTeacher || '',
      p.makeupSchedule || '',
      ticket.status || 'PENDING_TTCM',
      '',
      '',
      ''
    ]);
  });

  SpreadsheetApp.flush();
  return {
    success: true,
    message: "Đã lưu đơn nghỉ thành công!",
    ticketId: generatedTicketId
  };
}

// 3. CẬP NHẬT TRẠNG THÁI & LỊCH DẠY THAY VÀO SHEET LICHNGHI
function updateLeaveStatus(ticketId, status, periods) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetLN = getSheetSafe(ss, 'LichNghi');
  if (!sheetLN) return { success: false, message: "Không tìm thấy sheet LichNghi" };

  const rawLN = sheetLN.getDataRange().getValues();
  let periodIdx = 0;
  const nowStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");

  for (let i = 1; i < rawLN.length; i++) {
    if (String(rawLN[i][0]).trim() === String(ticketId).trim()) {
      const row = i + 1;
      // Cột 17: Trạng thái duyệt
      sheetLN.getRange(row, 17).setValue(status);

      // Nếu có cập nhật danh sách người dạy thay từ TTCM
      if (periods && periods[periodIdx]) {
        const p = periods[periodIdx];
        if (p.subTeacher) sheetLN.getRange(row, 15).setValue(p.subTeacher);
        if (p.makeupSchedule) sheetLN.getRange(row, 16).setValue(p.makeupSchedule);
        periodIdx++;
      }

      // Nếu BGH duyệt
      if (status === 'APPROVED_BGH') {
        sheetLN.getRange(row, 20).setValue(nowStr);
      }
    }
  }

  SpreadsheetApp.flush();
  return { success: true, message: "Cập nhật trạng thái duyệt đơn thành công!" };
}

// 4. CHẤM ĐIỂM KPI (CỘT F SHEET DATA)
function gradeTask(maGV, maViec, score) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = getSheetSafe(ss, 'data');
  if (!sheetData) return { success: false, message: "Không tìm thấy sheet data" };

  const rawData = sheetData.getDataRange().getValues();
  for (let i = 1; i < rawData.length; i++) {
    const rowMaViec = String(rawData[i][0]).trim().toUpperCase();
    const rowMaGV = String(rawData[i][1]).trim().toUpperCase();
    if (rowMaViec === String(maViec).trim().toUpperCase() &&
        (rowMaGV === String(maGV).trim().toUpperCase() || rowMaGV === 'GV')) {
      const row = i + 1;
      sheetData.getRange(row, 4).setValue("Đã xong");
      sheetData.getRange(row, 6).setValue(Number(score));
      SpreadsheetApp.flush();
      return { success: true, message: `Đã chấm điểm thành công cho ${maGV}!` };
    }
  }
  return { success: false, message: "Không tìm thấy nhiệm vụ trong sheet data" };
}

// 5. ĐĂNG KÝ HOẶC GIAO VIỆC
function registerTask(maGV, maViec, tenGV, dinhMuc) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = getSheetSafe(ss, 'data');
  const sheetKho = getSheetSafe(ss, 'kho KPI') || getSheetSafe(ss, 'Kho KPI');
  const sheetNS = getSheetSafe(ss, 'Nhân sự');

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

// 6. NỘP MINH CHỨNG
function submitProof(maGV, maViec, url) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetData = getSheetSafe(ss, 'data');
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

// 7. TẠO VIỆC MỚI VÀO KHO KPI
function addNewTask(maViec, tenViec, moTa, dinhMuc, hanChot, chiTieu) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetKho = getSheetSafe(ss, 'kho KPI') || getSheetSafe(ss, 'Kho KPI');
  if (!sheetKho) return { success: false, message: "Thiếu sheet kho KPI" };

  sheetKho.appendRow([maViec, tenViec, moTa, Number(dinhMuc) || 0, hanChot, Number(chiTieu) || 1, 'Còn việc']);
  SpreadsheetApp.flush();
  return { success: true, message: "Tạo việc mới thành công!" };
}
  // =========================================================================
// 8. NGHIỆP VỤ PHÂN HỆ QUẢN LÝ HỌC SINH (SHEET: dataHS)
// =========================================================================

// Danh mục 15 loại lỗi vi phạm khớp chuẩn 15 cột từ E -> S của sheet dataHS
const VIOLATION_COLUMNS = [
  "Nghỉ CP", "Nghỉ KP", "Bỏ tiết", "Đi muộn", "Vô lễ",
  "Đánh nhau", "Đánh nhau nghiêm trọng", "Vi phạm ATGT",
  "Vi phạm ATGT nghiêm trọng", "Không thẻ", "Trang phục, đầu tóc",
  "Không chuẩn bị bài", "Vi phạm QCT", "Vi phạm QCT nghiêm trọng", "VP khác"
];

// Hàm lưu vi phạm mới vào dòng trống đầu tiên của sheet dataHS
function saveViolationRecord(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = getSheetSafe(ss, 'dataHS');

  if (!sheet) {
    sheet = ss.insertSheet('dataHS');
    sheet.appendRow(["Mã HS", "Ngày theo dõi", "Lớp", "Họ và tên", ...VIOLATION_COLUMNS]);
  }

  // Chuẩn bị hàng 19 cột theo thứ tự chuẩn:
  // A: Mã HS | B: Ngày theo dõi | C: Lớp | D: Họ và tên
  const rowData = [
    data.maHS || "",
    data.ngay || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy"),
    data.lop || "",
    data.hoTen || ""
  ];

  // E -> S: 15 loại lỗi vi phạm
  const selectedErrors = data.selectedErrors || [];
  VIOLATION_COLUMNS.forEach(errName => {
    if (selectedErrors.includes(errName)) {
      rowData.push(1); // Ghi nhận lỗi
    } else {
      rowData.push(""); // Không vi phạm
    }
  });

  sheet.appendRow(rowData);
  SpreadsheetApp.flush();
  return { success: true, message: "Đã lưu bản ghi vi phạm vào sheet dataHS thành công!" };
}

// Hàm đọc và lọc danh sách vi phạm của học sinh theo điều kiện
function getStudentViolations(params) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSheetSafe(ss, 'dataHS');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, data: [] };

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1);

  const maHS = (params.maHS || "").trim().toLowerCase();
  const hoTen = (params.hoTen || "").trim().toLowerCase();
  const fromDate = parseDateCustom(params.fromDate);
  const toDate = parseDateCustom(params.toDate);

  const filtered = [];

  rows.forEach(row => {
    const rMaHS = String(row[0] || "").trim().toLowerCase();
    let rNgayStr = "";
    if (row[1] instanceof Date) {
      rNgayStr = Utilities.formatDate(row[1], "GMT+7", "dd/MM/yyyy");
    } else {
      rNgayStr = String(row[1] || "").trim();
    }

    const rLop = String(row[2] || "").trim();
    const rHoTen = String(row[3] || "").trim().toLowerCase();
    const rDate = parseDateCustom(rNgayStr);

    let match = true;
    if (maHS && rMaHS !== maHS) match = false;
    if (hoTen && !rHoTen.includes(hoTen)) match = false;

    if (match && rDate) {
      if (fromDate && rDate < fromDate) match = false;
      if (toDate && rDate > toDate) match = false;
    }

    if (match) {
      // Đếm và lấy danh sách lỗi trong ngày của học sinh đó
      const errors = [];
      for (let i = 4; i < headers.length; i++) {
        if (row[i] !== "" && row[i] !== null && Number(row[i]) > 0) {
          errors.push(headers[i]);
        }
      }

      filtered.push({
        maHS: row[0],
        ngay: rNgayStr,
        lop: rLop,
        hoTen: row[3],
        errors: errors,
        rawRow: row // Lưu hàng nguyên bản phục vụ xuất Excel chuẩn 19 cột
      });
    }
  });

  return { success: true, data: filtered };
}

// Hàm phụ trợ phân tích ngày an toàn
function parseDateCustom(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date) return dStr;
  dStr = String(dStr).split(" ")[0].trim();
  if (dStr.includes("/")) {
    const parts = dStr.split("/");
    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]);
  } else if (dStr.includes("-")) {
    const parts = dStr.split("-");
    if (parts.length === 3) return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return null;
}
