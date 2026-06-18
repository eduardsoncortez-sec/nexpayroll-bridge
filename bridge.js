/**
 * NexPayroll Biometric Bridge
 * 
 * Handles BOTH:
 * - T800 devices (JSON format with user_id, timestamp, etc.)
 * - F80/ZKTeco ADMS devices (ATTLOG tab-separated format)
 * 
 * Environment Variables:
 *   PORT - Server port (default: 9091)
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for DB writes
 *   COMPANY_ID - NexVision company UUID
 */

const http = require("http");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 9091;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMPANY_ID = process.env.COMPANY_ID || "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`[NexPayroll Bridge] Starting on port ${PORT}`);
console.log(`[NexPayroll Bridge] Supabase: ${SUPABASE_URL}`);
console.log(`[NexPayroll Bridge] Company: ${COMPANY_ID}`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sn = url.searchParams.get("SN") || url.searchParams.get("sn") || "";
  const table = url.searchParams.get("table") || url.searchParams.get("TABLE") || "";

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url} (SN: ${sn || "none"})`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // GET = handshake from device
  if (req.method === "GET") {
    // Update heartbeat if SN provided
    if (sn) {
      await supabase
        .from("biometric_devices")
        .update({ last_heartbeat: timestamp })
        .eq("device_sn", sn)
        .then(() => {})
        .catch(() => {});
    }

    // Respond with ADMS handshake
    const response = `GET OPTION FROM: ${sn || "unknown"}\r\nATTLOGStamp=0\r\nOPERLOGStamp=0\r\nErrorDelay=30\r\nDelay=10\r\nTransTimes=00:00;14:05\r\nTransInterval=1\r\nTransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP\tFACE\tUserPic\r\nRealtime=1\r\nEncrypt=0`;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(response);
    return;
  }

  // POST = data from device
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => { chunks.push(chunk); });
    req.on("end", async () => {
      // T800 may send data in Latin1/binary encoding, not UTF-8
      const rawBuffer = Buffer.concat(chunks);
      // Try UTF-8 first, then Latin1
      let body = rawBuffer.toString("utf8");
      // If we see garbled chars, try latin1
      if (body.includes("\ufffd") || body.includes("�")) {
        body = rawBuffer.toString("latin1");
      }

      console.log(`[${timestamp}] POST body (first 500 chars): ${body.substring(0, 500)}`);
      console.log(`[${timestamp}] Raw hex (first 100 bytes): ${rawBuffer.slice(0, 100).toString("hex")}`);

      try {
        // Try to parse as JSON first (T800 format)
        if (body.trim().startsWith("{") || body.trim().startsWith("[")) {
          const jsonData = JSON.parse(body);
          await handleT800Json(jsonData, sn);
        }
        // Check for ATTLOG tab-separated format (F80/ZKTeco ADMS)
        else if (body.includes("\t")) {
          await handleAttlog(body, sn, table);
        }
        // T800 may also send as form data or multipart
        else if (body.includes("user_id") || body.includes("punch_time") || body.includes("record_number")) {
          // Try to parse as URL-encoded or custom format
          await handleT800Custom(body, sn);
        }
        else {
          console.log(`[${timestamp}] Unknown format, logging raw data`);
          await logRawData(body, sn);
        }
      } catch (err) {
        console.error(`[${timestamp}] Error processing data:`, err.message);
        await logRawData(body, sn);
      }

      // Always respond OK to device
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    return;
  }

  // Fallback
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

// ---------------------------------------------------------------
// Handle T800 JSON format
// T800 sends: { "record_number": X, "enroll_data": {...}, "user_id": "1", "user_name": "...", ... }
// Or attendance: { "user_id": "1", "punch_time": "2026-06-17 08:30:00", "verify_type": 15, ... }
// ---------------------------------------------------------------
async function handleT800Json(data, sn) {
  console.log(`[T800] JSON data received:`, JSON.stringify(data).substring(0, 300));

  // Handle array of records
  const records = Array.isArray(data) ? data : [data];

  for (const record of records) {
    // Skip enrollment data (not attendance)
    if (record.enroll_data || record.template) {
      console.log(`[T800] Enrollment data for user ${record.user_id} — skipping (not attendance)`);
      continue;
    }

    // Attendance record
    const userId = record.user_id || record.pin || record.userId;
    const punchTimeStr = record.punch_time || record.timestamp || record.time;
    const verifyType = record.verify_type || record.verifyType || 0;

    if (!userId || !punchTimeStr) {
      console.log(`[T800] Missing user_id or punch_time in record:`, JSON.stringify(record).substring(0, 200));
      continue;
    }

    const punchTime = new Date(punchTimeStr);
    if (isNaN(punchTime.getTime())) {
      console.error(`[T800] Invalid punch time: ${punchTimeStr}`);
      continue;
    }

    console.log(`[T800] Attendance: User ${userId} at ${punchTimeStr} (verify: ${verifyType})`);

    // Store raw log
    await supabase.from("biometric_logs").insert({
      company_id: COMPANY_ID,
      device_sn: sn || "T800",
      biometric_user_id: String(userId),
      punch_time: punchTime.toISOString(),
      punch_type: 0,
      verify_type: verifyType,
      raw_payload: record,
      processed: false,
    });

    // Process into attendance
    await processAttendance(String(userId), punchTime, sn || "T800");
  }
}

// ---------------------------------------------------------------
// Handle T800 custom/mixed format (non-JSON, non-ATTLOG)
// ---------------------------------------------------------------
async function handleT800Custom(body, sn) {
  console.log(`[T800] Custom format data`);

  // Try to extract user_id and timestamp from various formats
  // Format might be: "record_number=1&user_id=1&punch_time=2026-06-17 08:30:00&..."
  const params = new URLSearchParams(body);
  const userId = params.get("user_id") || params.get("pin");
  const punchTimeStr = params.get("punch_time") || params.get("timestamp");

  if (userId && punchTimeStr) {
    const punchTime = new Date(punchTimeStr);
    if (!isNaN(punchTime.getTime())) {
      console.log(`[T800 Custom] Attendance: User ${userId} at ${punchTimeStr}`);
      await supabase.from("biometric_logs").insert({
        company_id: COMPANY_ID,
        device_sn: sn || "T800",
        biometric_user_id: String(userId),
        punch_time: punchTime.toISOString(),
        punch_type: 0,
        verify_type: 0,
        raw_payload: { raw: body },
        processed: false,
      });
      await processAttendance(String(userId), punchTime, sn || "T800");
      return;
    }
  }

  // If can't parse, just log it
  await logRawData(body, sn);
}

// ---------------------------------------------------------------
// Handle F80/ZKTeco ATTLOG format
// Format: "PIN\tTimestamp\tVerifyType\tInOutMode\tWorkCode"
// ---------------------------------------------------------------
async function handleAttlog(body, sn, table) {
  if (table === "OPERLOG") {
    const lines = body.split(/\r?\n/).filter(l => l.trim());
    console.log(`[ATTLOG] OPERLOG received (${lines.length} entries) — acknowledging`);
    return;
  }

  const lines = body.split(/\r?\n/).filter(l => l.trim());
  console.log(`[ATTLOG] Processing ${lines.length} attendance records`);

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const userId = parts[0].trim();
    const punchTimeStr = parts[1].trim();
    const verifyType = parseInt(parts[2] || "1", 10);
    const inOutMode = parseInt(parts[3] || "0", 10);

    const punchTime = new Date(punchTimeStr);
    if (isNaN(punchTime.getTime())) {
      console.error(`[ATTLOG] Invalid punch time: ${punchTimeStr}`);
      continue;
    }

    console.log(`[ATTLOG] User ${userId} at ${punchTimeStr} (verify: ${verifyType}, mode: ${inOutMode})`);

    await supabase.from("biometric_logs").insert({
      company_id: COMPANY_ID,
      device_sn: sn || "unknown",
      biometric_user_id: userId,
      punch_time: punchTime.toISOString(),
      punch_type: inOutMode,
      verify_type: verifyType,
      raw_payload: { line, parts },
      processed: false,
    });

    await processAttendance(userId, punchTime, sn || "unknown");
  }
}

// ---------------------------------------------------------------
// Log raw unrecognized data for debugging
// ---------------------------------------------------------------
async function logRawData(body, sn) {
  await supabase.from("biometric_logs").insert({
    company_id: COMPANY_ID,
    device_sn: sn || "unknown",
    biometric_user_id: "RAW_DATA",
    punch_time: new Date().toISOString(),
    punch_type: -1,
    verify_type: -1,
    raw_payload: { raw: body.substring(0, 2000) },
    processed: false,
    error_message: "Unrecognized format — logged for debugging",
  });
}

// ---------------------------------------------------------------
// Process attendance record into attendance_records table
// ---------------------------------------------------------------
async function processAttendance(biometricUserId, punchTime, deviceSn) {
  const PH_TZ = "Asia/Manila";
  const todayStr = punchTime.toLocaleDateString("en-CA", { timeZone: PH_TZ });
  const timeStr = punchTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: PH_TZ,
  });

  // Look up employee
  let personId = null;

  const { data: emp } = await supabase
    .from("employees")
    .select("id, status")
    .eq("company_id", COMPANY_ID)
    .eq("biometric_user_id", biometricUserId)
    .single();

  if (emp && emp.status === "active") {
    personId = emp.id;
  } else {
    const { data: intern } = await supabase
      .from("interns")
      .select("id, status")
      .eq("company_id", COMPANY_ID)
      .eq("biometric_user_id", biometricUserId)
      .single();

    if (intern && intern.status === "active") {
      personId = intern.id;
    }
  }

  if (!personId) {
    console.error(`  ❌ No employee/intern mapped for biometric user ${biometricUserId}`);
    await supabase.from("biometric_logs")
      .update({ error_message: "No active employee/intern mapped" })
      .eq("biometric_user_id", biometricUserId)
      .eq("processed", false)
      .order("created_at", { ascending: false })
      .limit(1);
    return;
  }

  // Check existing record
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("employee_id", personId)
    .eq("date", todayStr)
    .single();

  if (!existing) {
    // CLOCK IN
    const { data: newRecord } = await supabase
      .from("attendance_records")
      .insert({
        employee_id: personId,
        company_id: COMPANY_ID,
        date: todayStr,
        status: "present",
        time_in: timeStr,
        work_location: "onsite",
        entry_method: "biometric",
        notes: `Clocked in via biometric at ${timeStr}`,
      })
      .select()
      .single();

    console.log(`  ✅ CLOCK IN: ${personId} at ${timeStr}`);

    await supabase.from("attendance_events").insert({
      company_id: COMPANY_ID,
      employee_id: personId,
      nfc_uid: `BIO:${biometricUserId}`,
      event_type: "clock_in",
      device_id: deviceSn,
      timestamp: punchTime.toISOString(),
      processed: true,
      source_type: "biometric",
      attendance_record_id: newRecord?.id || null,
    });

    await supabase.from("biometric_logs")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("biometric_user_id", biometricUserId)
      .eq("punch_time", punchTime.toISOString());

  } else if (existing.time_in && !existing.time_out) {
    // CLOCK OUT
    await supabase
      .from("attendance_records")
      .update({
        time_out: timeStr,
        notes: `Clocked in at ${existing.time_in}, out via biometric at ${timeStr}`,
      })
      .eq("id", existing.id);

    console.log(`  ✅ CLOCK OUT: ${personId} at ${timeStr}`);

    await supabase.from("attendance_events").insert({
      company_id: COMPANY_ID,
      employee_id: personId,
      nfc_uid: `BIO:${biometricUserId}`,
      event_type: "clock_out",
      device_id: deviceSn,
      timestamp: punchTime.toISOString(),
      processed: true,
      source_type: "biometric",
      attendance_record_id: existing.id,
    });

    await supabase.from("biometric_logs")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("biometric_user_id", biometricUserId)
      .eq("punch_time", punchTime.toISOString());

  } else {
    console.log(`  ⚠️ Already clocked in and out today for ${personId}`);
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[NexPayroll Bridge] ✅ Listening on port ${PORT}`);
  console.log(`[NexPayroll Bridge] Device should push to: http://<server-ip>:${PORT}/iclock/cdata?SN=<device-sn>`);
});
