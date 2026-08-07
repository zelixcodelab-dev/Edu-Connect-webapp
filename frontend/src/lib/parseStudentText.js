/**
 * Loose, line-based parser for pasted student admission text.
 *
 * Designed for the operator workflow where someone receives a WhatsApp /
 * SMS / email blob like:
 *
 *   Name of the student : Anupama V V
 *   Student contact no : 9656592598
 *   Course : Bse Nursing
 *   ...
 *
 * Returns a partial ApplicationIn-shaped object. Fields that can't be parsed
 * are left blank — the review dialog lets the operator fill the gaps before
 * saving.
 *
 * Robust to:
 *  - Missing colons / extra spaces
 *  - Multi-line address blocks (consecutive lines that don't look like new keys
 *    are appended to the previous key's value)
 *  - Different date separators (/ . -)
 *  - Mark suffixes ("80%", "78.5 %", "85/100")
 */

// Normalise a key for lookup — lowercase, drop everything but a-z & 0-9.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+]/g, "");

// Key dictionary: every alias maps to a single canonical field id.
// Aliases are matched as STARTS-WITH on the normalised key to be forgiving.
const KEY_ALIASES = [
  // basic_info
  { canon: "name",            aliases: ["nameofthestudent", "studentname", "studentfullname", "name"] },
  { canon: "mobile",          aliases: ["studentcontactno", "studentmobile", "mobilenumber", "contactno", "phone", "mobile", "contact"] },
  { canon: "email",           aliases: ["studentemailid", "emailid", "email"] },
  { canon: "dob",             aliases: ["dateofbirth", "dob"] },
  { canon: "gender",          aliases: ["sexmalefemale", "gender", "sex"] },
  { canon: "aadhaar",         aliases: ["aadhaarnumber", "aadharnumber", "aadhaar", "aadhar"] },
  { canon: "nationality",     aliases: ["nationality"] },
  { canon: "religion",        aliases: ["religion"] },
  { canon: "caste",           aliases: ["nameofthecaste", "caste"] },
  { canon: "community",       aliases: ["community"] },

  // course
  { canon: "course",          aliases: ["course", "interestedcourse", "branch"] },
  { canon: "college",         aliases: ["college", "preferredcollege", "collegename"] },
  { canon: "academic_year",   aliases: ["academicyear", "batch", "year"] },

  // communication
  { canon: "father_name",     aliases: ["fathername", "fathersname"] },
  { canon: "father_mobile",   aliases: ["fathermobilenumber", "fathermobile", "fathercontact", "fatherno"] },
  { canon: "mother_name",     aliases: ["mothername", "mothersname"] },
  { canon: "mother_mobile",   aliases: ["mothermobilenumber", "mothermobile", "mothercontact", "motherno"] },
  { canon: "address",         aliases: ["address", "permanentaddress", "homeaddress"] },
  { canon: "city",            aliases: ["city", "town"] },
  { canon: "state",           aliases: ["state"] },
  { canon: "pincode",         aliases: ["pincode", "pin", "zipcode"] },

  // academic — 10th
  { canon: "tenth_school",    aliases: ["10thschoolnameandplace", "10thschoolname", "10thschool", "schoolname10th"] },
  { canon: "tenth_mark",      aliases: ["10thmark", "10thmarks", "10thpercentage"] },
  { canon: "tenth_reg",       aliases: ["10thregisternumber", "10thregno", "10thregistrationnumber", "registernumber10th"] },
  { canon: "tenth_board",     aliases: ["10thboard"] },
  { canon: "tenth_year",      aliases: ["10thyearofpassing", "10thpassingyear"] },

  // academic — 12th / +2
  { canon: "twelfth_school",  aliases: ["+2schoolname", "+2schoolnameandplace", "12thschoolname", "12thschool", "plustwoschool"] },
  { canon: "twelfth_mark",    aliases: ["+2mark", "+2marks", "12thmark", "12thmarks", "12thpercentage", "plustwomark"] },
  { canon: "twelfth_reg",     aliases: ["+2registernumber", "+2regno", "12thregisternumber", "12thregno", "plustworegisternumber"] },
  { canon: "twelfth_board",   aliases: ["+2board", "12thboard"] },
  { canon: "twelfth_year",    aliases: ["+2yearofpassing", "12thyearofpassing", "12thpassingyear"] },

  // ambiguous "register number" — defaults to 10th (sample text uses
  // "10th/12th register Number"). If the operator pastes a row labelled
  // simply "Register Number" we'll fill 10th; they can edit in the dialog.
  { canon: "tenth_reg",       aliases: ["10th12thregisternumber", "registernumber", "regno"] },

  // misc — captured into notes so nothing is lost
  { canon: "hostel_or_bus",   aliases: ["hostelorbus", "hostel", "transport"] },
];

function canonForKey(rawKey) {
  const n = norm(rawKey);
  if (!n) return null;
  // Longest match first (so "10thschoolnameandplace" beats "10thschool").
  let best = null;
  for (const row of KEY_ALIASES) {
    for (const a of row.aliases) {
      if (n === a || n.startsWith(a)) {
        if (!best || a.length > best.matchLen) {
          best = { canon: row.canon, matchLen: a.length };
        }
      }
    }
  }
  return best?.canon || null;
}

function parseDOB(raw) {
  if (!raw) return "";
  // Trim and grab the first date-like substring.
  const m = String(raw).match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
  if (!m) return "";
  let [, a, b, c] = m;
  // If the first chunk is a 4-digit year → ISO already.
  if (a.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
  // Otherwise assume DD/MM/YYYY (the common Indian convention shown in the sample).
  if (c.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  // Two-digit year fallback — assume 20YY.
  if (c.length === 2) return `20${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  return "";
}

function parseGender(raw) {
  const v = norm(raw);
  if (!v) return "";
  if (v.startsWith("f")) return "female";
  if (v.startsWith("m")) return "male";
  return "other";
}

function parseMobile(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  // Indian mobile numbers — keep last 10 digits.
  return digits.slice(-10);
}

function parseMark(raw) {
  if (!raw) return "";
  // Accept "80%", "78.5 %", "85/100", or plain "80".
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

function empty() {
  return {
    basic_info: {
      student_full_name: "", mobile_number: "", email: "",
      date_of_birth: "", gender: "male", aadhaar_number: "",
      nationality: "Indian", religion: "", caste: "",
    },
    course: {
      interested_course: "", preferred_college: "",
      academic_year: "", admission_type: "management",
    },
    communication: {
      father_name: "", father_mobile: "", mother_name: "", mother_mobile: "",
      address_line_1: "", address_line_2: "",
      city: "", state: "Kerala", pincode: "",
    },
    academic: {
      tenth: { register_number: "", school_name: "", school_place: "", board: "", year_of_passing: "", percentage: "" },
      twelfth: { register_number: "", school_name: "", school_place: "", board: "", year_of_passing: "", percentage: "" },
    },
    payment: { registration_amount: 0, payment_date: "", payment_mode: "upi", transaction_id: "" },
    reference: { type: "sub_agent", name: "", contact_number: "", place: "", notes: "" },
    _meta: { unmatched: [], hostel_or_bus: "", community: "" },
  };
}

export function parseStudentText(raw) {
  const out = empty();
  if (!raw || typeof raw !== "string") return out;

  // Step 1 — tokenise lines into {canon, value} pairs.
  // A line is "key : value" (colon is the splitter, first colon wins).
  // Lines without a colon belong to the previous key (multi-line address etc.).
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pairs = []; // [{canon, value, rawKey}]
  let lastIdx = -1;
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < line.length - 1) {
      const rawKey = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1).trim();
      const canon = canonForKey(rawKey);
      pairs.push({ canon, value, rawKey });
      lastIdx = pairs.length - 1;
    } else if (colonIdx === line.length - 1) {
      // "Key :" with no value — register an empty pair so subsequent value lines attach correctly
      const rawKey = line.slice(0, colonIdx);
      const canon = canonForKey(rawKey);
      pairs.push({ canon, value: "", rawKey });
      lastIdx = pairs.length - 1;
    } else if (lastIdx >= 0) {
      // No colon → append to previous value (common for address line 2, place, etc.)
      pairs[lastIdx].value = `${pairs[lastIdx].value} ${line}`.trim();
    }
  }

  // Step 2 — apply canonical assignments.
  for (const { canon, value, rawKey } of pairs) {
    if (!canon) {
      if (rawKey && value) out._meta.unmatched.push(`${rawKey.trim()}: ${value}`);
      continue;
    }
    if (!value) continue;
    switch (canon) {
      case "name": out.basic_info.student_full_name = value; break;
      case "mobile": out.basic_info.mobile_number = parseMobile(value); break;
      case "email": out.basic_info.email = value; break;
      case "dob": out.basic_info.date_of_birth = parseDOB(value); break;
      case "gender": out.basic_info.gender = parseGender(value) || "male"; break;
      case "aadhaar": out.basic_info.aadhaar_number = String(value).replace(/\s+/g, ""); break;
      case "nationality": out.basic_info.nationality = value; break;
      case "religion": out.basic_info.religion = value; break;
      case "caste": out.basic_info.caste = value; break;
      case "community": out._meta.community = value; break;

      case "course": out.course.interested_course = value; break;
      case "college": out.course.preferred_college = value; break;
      case "academic_year": out.course.academic_year = value; break;

      case "father_name": out.communication.father_name = value; break;
      case "father_mobile": out.communication.father_mobile = parseMobile(value); break;
      case "mother_name": out.communication.mother_name = value; break;
      case "mother_mobile": out.communication.mother_mobile = parseMobile(value); break;
      case "address": {
        // Address may bundle "Address line 1 / city / state / pincode".
        // We dump everything into address_line_1 and let the operator split if needed.
        if (!out.communication.address_line_1) out.communication.address_line_1 = value;
        else out.communication.address_line_2 = value;
        break;
      }
      case "city": out.communication.city = value; break;
      case "state": out.communication.state = value; break;
      case "pincode": out.communication.pincode = String(value).replace(/\D/g, "").slice(0, 6); break;

      case "tenth_school": out.academic.tenth.school_name = value; break;
      case "tenth_mark": out.academic.tenth.percentage = parseMark(value); break;
      case "tenth_reg": out.academic.tenth.register_number = String(value).trim(); break;
      case "tenth_board": out.academic.tenth.board = value; break;
      case "tenth_year": out.academic.tenth.year_of_passing = String(value).trim(); break;

      case "twelfth_school": out.academic.twelfth.school_name = value; break;
      case "twelfth_mark": out.academic.twelfth.percentage = parseMark(value); break;
      case "twelfth_reg": out.academic.twelfth.register_number = String(value).trim(); break;
      case "twelfth_board": out.academic.twelfth.board = value; break;
      case "twelfth_year": out.academic.twelfth.year_of_passing = String(value).trim(); break;

      case "hostel_or_bus": out._meta.hostel_or_bus = value; break;

      default: break;
    }
  }

  // Step 3 — surface "hostel_or_bus" + "community" into the reference notes so
  // nothing is lost in the saved application.
  const extraNotes = [];
  if (out._meta.hostel_or_bus) extraNotes.push(`Hostel/Bus: ${out._meta.hostel_or_bus}`);
  if (out._meta.community) extraNotes.push(`Community: ${out._meta.community}`);
  if (extraNotes.length) out.reference.notes = extraNotes.join(" · ");

  return out;
}

export function buildApplicationPayload(parsed) {
  // Strip our internal _meta wrapper before posting to the API.
  // eslint-disable-next-line no-unused-vars
  const { _meta, ...clean } = parsed || {};
  return clean;
}
