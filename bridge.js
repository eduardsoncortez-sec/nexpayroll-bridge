/**
 * NexPayroll Biometric Bridge
 * 
 * A standalone HTTP server that receives attendance push data from
 * ZKTeco F80 biometric device and writes it to Supabase.
 * 
 * Deploy this on Coolify with a public IP so the device can reach it.
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

// Track last processed stamps per device to avoid duplicates
const deviceStamps = {};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sn = url.searchParams.get("SN") || url.searchParams.get("sn") || "unknown";
  const table = url.searchParams.get("table") || url.searchParams.get("TABLE") || "";

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} (SN: ${sn})`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // GET = device handshake
  if (req.method === "GET") {
    // Update device heartbeat
    await supabase
      .from("biometric_devices")
      .update({ last_heartbeat: new Date().toISOString() })
      .eq("device_sn", sn)
      .then(() => {})
      .catch(() => {});

    // Respond with ADMS protocol - tell device to send data
    const response = [
      `GET OPTION FROM: ${sn}`,
      `Stamp=9999`,
      `OpStamp=${Math.floor(Date.now() / 1000)}`,
      `ErrorDelay=60`,
      `Delay=10`,
      `ResLogDay=18250`,
      `ResLogDelCount=10000`,
      `ResLogCount=50000`,
      `TransTimes=00:00;14:05`,
      `TransInterval=1`,
      `TransFlag=1111000000`,
      `Realtime=1`,
      `Encrypt=0`,
    ].join("\r\n");

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(response);
    return;
  }

  // POST = device sending attendance data
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", async () => {
      console.log(`[${new Date().toISOString()}] POST data from ${sn} (table: ${table}):`);
      console.log(body);

      // Handle OPERLOG (operation log) - just acknowledge
      if (table === "OPERLOG") {
        const lines = body.split(/\r?\n/).filter((l) => l.trim());
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`OK: ${lines.length}`);
        return;
      }

      // Handle ATTLOG (attendance log)
      if (table === "ATTLOG" || body.includes("\t")) {
        const lines = body.split(/\r?\n/).filter((l) => l.trim());
        let processed = 0;

        for (const line of lines) {
          const parts = line.split("\t");
          if (parts.length < 2) continue;

          const biometricUserId = parts[0].trim();
          const punchTimeStr = parts[1].trim();
          const verifyType = parseInt(parts[2] || "1", 10);
          const inOutMode = parseInt(parts[3] || "0", 10);

          const punchTime = new Date(punchTimeStr);
          if (isNaN(punchTime.getTime())) {
            console.error(`  Invalid punch time: ${punchTimeStr}`);
            continue;
          }

          console.log(`  User: ${biometricUserId}, Time: ${punchTimeStr}, Verify: ${verifyType}, Mode: ${inOutMode}`);

          // Store raw log
          await supabase.from("biometric_logs").insert({
            company_id: COMPANY_ID,
            device_sn: sn,
            biometric_user_id: biometricUserId,
            punch_time: punchTime.toISOString(),
            punch_type: inOutMode,
            verify_type: verifyType,
            raw_payload: { line, parts },
            processed: false,
          });

          // Process into attendance record
          await processAttendance(biometricUserId, punchTime, sn);
          processed++;
        }

        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(`OK: ${processed}`);
        return;
      }

      // Unknown table - just acknowledge
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    return;
  }

  // Fallback
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
});

async function processAttendance(biometricUserId, punchTime, deviceSn) {
  const PH_TZ = "Asia/Manila";
  const todayStr = punchTime.toLocaleDateString("en-CA", { timeZone: PH_TZ });
  const timeStr = punchTime.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: PH_TZ,
  });

  // Look up employee by biometric_user_id
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
    console.error(`  No employee/intern mapped for biometric user ${biometricUserId}`);
    return;
  }

  // Check existing record for today
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

    console.log(`  ✅ CLOCK IN: ${personId} at ${timeStr} (record: ${newRecord?.id})`);

    // Log event
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

  } else {
    console.log(`  ⚠️ Already clocked in and out today for ${personId}`);
  }

  // Mark biometric log as processed
  await supabase
    .from("biometric_logs")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("device_sn", deviceSn)
    .eq("biometric_user_id", biometricUserId)
    .eq("punch_time", punchTime.toISOString());
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[NexPayroll Bridge] ✅ Listening on port ${PORT}`);
  console.log(`[NexPayroll Bridge] Device should push to: http://<server-ip>:${PORT}/iclock/cdata?SN=<device-sn>`);
});
