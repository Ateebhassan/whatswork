// Generated from planner-core.js and ww-core.js by build-worker-core.sh. Edit those files, not this one.
/* College Planner core: built-in days, rules and the year builder.
   Shared by the Planner page, the WhatsWork calendar and the background worker. Pure logic, no page access. */
var COLLEGES = {
  both: { name: 'Both colleges', print: 'Superior College and Allama Iqbal Law College' },
  superior: { name: 'Superior College', print: 'Superior College Sargodha' },
  law: { name: 'Allama Iqbal Law College', print: 'Allama Iqbal Law College' }
};

var CATEGORIES = {
  national: { name: 'National day', color: '#c62828' },
  islamic: { name: 'Islamic day', color: '#2e7d32' },
  education: { name: 'Education day', color: '#6d3fc0' },
  law: { name: 'Law and rights day', color: '#8c1d2f' },
  health: { name: 'Health day', color: '#0277a8' },
  world: { name: 'World day', color: '#2f55d4' },
  college: { name: 'College event', color: '#c05a00' },
  weekly: { name: 'Weekly post', color: '#00897b' },
  birthday: { name: 'Faculty birthday', color: '#6b7280' }
};

/* Rules:  [month, day] fixed date
           {wk: weekday}  every week on that weekday (5 = Friday)
           {m, n, wd}   nth weekday of a month (wd 0 = Sunday)
           {h:[hijriMonth, hijriDay]}  Islamic date, shown as tentative            */
var BUILTIN_EVENTS = [
  /* National */
  ['new-year', 'New Year\'s Day', 'world', 'both', 'minor', [1, 1]],
  ['kashmir-solidarity', 'Kashmir Solidarity Day', 'national', 'both', 'major', [2, 5]],
  ['pakistan-day', 'Pakistan Day', 'national', 'both', 'major', [3, 23]],
  ['constitution-day', 'National Constitution Day', 'law', 'both', 'major', [4, 10]],
  ['iqbal-death', 'Allama Iqbal death anniversary', 'national', 'both', 'major', [4, 21]],
  ['labour-day', 'Labour Day', 'national', 'both', 'minor', [5, 1]],
  ['takbeer', 'Youm-e-Takbeer', 'national', 'both', 'minor', [5, 28]],
  ['fatima-jinnah', 'Fatima Jinnah death anniversary', 'national', 'both', 'minor', [7, 9]],
  ['istehsal', 'Youm-e-Istehsal Kashmir', 'national', 'both', 'minor', [8, 5]],
  ['minorities-day', 'National Minorities Day', 'national', 'both', 'minor', [8, 11]],
  ['independence', 'Independence Day', 'national', 'both', 'major', [8, 14]],
  ['defence-day', 'Defence Day', 'national', 'both', 'major', [9, 6]],
  ['air-force-day', 'Air Force Day', 'national', 'both', 'minor', [9, 7]],
  ['quaid-death', 'Quaid-e-Azam death anniversary', 'national', 'both', 'major', [9, 11]],
  ['kashmir-black', 'Kashmir Black Day', 'national', 'both', 'minor', [10, 27]],
  ['iqbal-day', 'Iqbal Day', 'national', 'both', 'major', [11, 9]],
  ['aps', 'Army Public School martyrs remembrance day', 'national', 'both', 'minor', [12, 16]],
  ['quaid-day', 'Quaid-e-Azam Day', 'national', 'both', 'major', [12, 25]],
  ['christmas', 'Christmas Day', 'world', 'both', 'minor', [12, 25]],

  /* Weekly posts */
  ['jummah', 'Jummah Mubarak post', 'weekly', 'both', 'minor', { wk: 5 }],

  /* Islamic (moon sighting) */
  ['islamic-new-year', 'Islamic New Year (1 Muharram)', 'islamic', 'both', 'minor', { h: [1, 1] }],
  ['ashura', 'Ashura (10 Muharram)', 'islamic', 'both', 'major', { h: [1, 10] }],
  ['eid-milad', 'Eid Milad-un-Nabi', 'islamic', 'both', 'major', { h: [3, 12] }],
  ['shab-e-miraj', 'Shab-e-Miraj', 'islamic', 'both', 'minor', { h: [7, 27] }],
  ['shab-e-barat', 'Shab-e-Barat', 'islamic', 'both', 'minor', { h: [8, 15] }],
  ['ramadan-start', 'Ramadan begins', 'islamic', 'both', 'major', { h: [9, 1] }],
  ['eid-ul-fitr', 'Eid-ul-Fitr', 'islamic', 'both', 'major', { h: [10, 1] }],
  ['arafah', 'Day of Arafah (Hajj)', 'islamic', 'both', 'minor', { h: [12, 9] }],
  ['eid-ul-adha', 'Eid-ul-Adha', 'islamic', 'both', 'major', { h: [12, 10] }],

  /* Education */
  ['education-day', 'International Day of Education', 'education', 'both', 'minor', [1, 24]],
  ['women-science', 'International Day of Women and Girls in Science', 'education', 'superior', 'minor', [2, 11]],
  ['mother-language', 'International Mother Language Day', 'education', 'both', 'minor', [2, 21]],
  ['maths-day', 'International Day of Mathematics', 'education', 'superior', 'minor', [3, 14]],
  ['book-day', 'World Book and Copyright Day', 'education', 'both', 'minor', [4, 23]],
  ['youth-skills', 'World Youth Skills Day', 'education', 'both', 'minor', [7, 15]],
  ['youth-day', 'International Youth Day', 'education', 'both', 'minor', [8, 12]],
  ['literacy-day', 'International Literacy Day', 'education', 'both', 'major', [9, 8]],
  ['teachers-day', 'World Teachers\' Day', 'education', 'both', 'major', [10, 5]],
  ['sir-syed-day', 'Sir Syed Day', 'education', 'both', 'minor', [10, 17]],
  ['science-day', 'World Science Day for Peace and Development', 'education', 'superior', 'minor', [11, 10]],
  ['students-day', 'International Students\' Day', 'education', 'both', 'major', [11, 17]],

  /* Law and rights */
  ['social-justice', 'World Day of Social Justice', 'law', 'law', 'minor', [2, 20]],
  ['consumer-rights', 'World Consumer Rights Day', 'law', 'law', 'minor', [3, 15]],
  ['racial-discrimination', 'International Day for the Elimination of Racial Discrimination', 'law', 'law', 'minor', [3, 21]],
  ['ip-day', 'World Intellectual Property Day', 'law', 'law', 'minor', [4, 26]],
  ['press-freedom', 'World Press Freedom Day', 'law', 'law', 'minor', [5, 3]],
  ['child-labour', 'World Day Against Child Labour', 'law', 'law', 'minor', [6, 12]],
  ['refugee-day', 'World Refugee Day', 'law', 'law', 'minor', [6, 20]],
  ['drug-abuse', 'International Day Against Drug Abuse', 'law', 'both', 'minor', [6, 26]],
  ['international-justice', 'World Day for International Justice', 'law', 'law', 'major', [7, 17]],
  ['trafficking', 'World Day Against Trafficking in Persons', 'law', 'law', 'minor', [7, 30]],
  ['humanitarian', 'World Humanitarian Day', 'law', 'law', 'minor', [8, 19]],
  ['democracy-day', 'International Day of Democracy', 'law', 'both', 'minor', [9, 15]],
  ['access-information', 'International Day for Universal Access to Information', 'law', 'law', 'minor', [9, 28]],
  ['un-day', 'United Nations Day', 'law', 'law', 'minor', [10, 24]],
  ['tolerance', 'International Day for Tolerance', 'law', 'both', 'minor', [11, 16]],
  ['children-day', 'World Children\'s Day', 'law', 'both', 'minor', [11, 20]],
  ['violence-women', 'International Day for the Elimination of Violence Against Women', 'law', 'law', 'minor', [11, 25]],
  ['disabilities', 'International Day of Persons with Disabilities', 'law', 'both', 'minor', [12, 3]],
  ['anti-corruption', 'International Anti-Corruption Day', 'law', 'law', 'minor', [12, 9]],
  ['human-rights', 'Human Rights Day', 'law', 'both', 'major', [12, 10]],

  /* Health */
  ['cancer-day', 'World Cancer Day', 'health', 'superior', 'minor', [2, 4]],
  ['tb-day', 'World Tuberculosis Day', 'health', 'superior', 'minor', [3, 24]],
  ['autism-day', 'World Autism Awareness Day', 'health', 'superior', 'minor', [4, 2]],
  ['health-day', 'World Health Day', 'health', 'superior', 'minor', [4, 7]],
  ['nurses-day', 'International Nurses Day', 'health', 'superior', 'minor', [5, 12]],
  ['no-tobacco', 'World No Tobacco Day', 'health', 'both', 'minor', [5, 31]],
  ['blood-donor', 'World Blood Donor Day', 'health', 'superior', 'minor', [6, 14]],
  ['hepatitis', 'World Hepatitis Day', 'health', 'superior', 'minor', [7, 28]],
  ['suicide-prevention', 'World Suicide Prevention Day', 'health', 'both', 'minor', [9, 10]],
  ['first-aid', 'World First Aid Day', 'health', 'superior', 'minor', { m: 9, n: 2, wd: 6 }],
  ['pharmacists', 'World Pharmacists Day', 'health', 'superior', 'minor', [9, 25]],
  ['heart-day', 'World Heart Day', 'health', 'superior', 'minor', [9, 29]],
  ['mental-health', 'World Mental Health Day', 'health', 'both', 'major', [10, 10]],
  ['handwashing', 'Global Handwashing Day', 'health', 'superior', 'minor', [10, 15]],
  ['polio-day', 'World Polio Day', 'health', 'superior', 'minor', [10, 24]],
  ['diabetes-day', 'World Diabetes Day', 'health', 'superior', 'minor', [11, 14]],
  ['aids-day', 'World AIDS Day', 'health', 'superior', 'minor', [12, 1]],

  /* World days */
  ['women-day', 'International Women\'s Day', 'world', 'both', 'major', [3, 8]],
  ['water-day', 'World Water Day', 'world', 'superior', 'minor', [3, 22]],
  ['earth-day', 'Earth Day', 'world', 'both', 'minor', [4, 22]],
  ['mothers-day', 'Mother\'s Day', 'world', 'both', 'minor', { m: 5, n: 2, wd: 0 }],
  ['environment-day', 'World Environment Day', 'world', 'both', 'minor', [6, 5]],
  ['fathers-day', 'Father\'s Day', 'world', 'both', 'minor', { m: 6, n: 3, wd: 0 }],
  ['population-day', 'World Population Day', 'world', 'superior', 'minor', [7, 11]],
  ['photography-day', 'World Photography Day', 'world', 'both', 'minor', [8, 19]],
  ['cleanup-day', 'World Cleanup Day', 'world', 'both', 'minor', [9, 20]],
  ['peace-day', 'International Day of Peace', 'world', 'both', 'minor', [9, 21]],
  ['tourism-day', 'World Tourism Day', 'world', 'superior', 'minor', [9, 27]],
  ['girl-child', 'International Day of the Girl Child', 'world', 'both', 'minor', [10, 11]],
  ['food-day', 'World Food Day', 'world', 'superior', 'minor', [10, 16]],
  ['volunteer-day', 'International Volunteer Day', 'world', 'both', 'minor', [12, 5]],
  /* ----- Added October 2026: wider coverage ----- */
  ['shab-e-qadr', 'Shab-e-Qadr (27 Ramadan)', 'islamic', 'both', 'minor', { h: [9, 27] }],
  ['kashmir-martyrs', 'Kashmir Martyrs\' Day', 'national', 'both', 'minor', [7, 13]],
  ['fatima-jinnah-birth', 'Fatima Jinnah birth anniversary', 'national', 'both', 'minor', [7, 31]],
  ['police-martyrs', 'Police Martyrs\' Day', 'national', 'both', 'minor', [8, 4]],
  ['rashid-minhas', 'Rashid Minhas Shaheed Day', 'national', 'both', 'minor', [8, 20]],
  ['navy-day', 'Navy Day', 'national', 'both', 'minor', [9, 8]],
  ['aziz-bhatti', 'Major Aziz Bhatti Shaheed Day', 'national', 'both', 'minor', [9, 12]],
  ['liaquat-ali-khan', 'Liaquat Ali Khan death anniversary', 'national', 'both', 'minor', [10, 16]],
  ['working-women', 'National Working Women\'s Day', 'national', 'both', 'minor', [12, 22]],

  ['safer-internet', 'Safer Internet Day', 'education', 'both', 'minor', { m: 2, n: 2, wd: 2 }],
  ['engineering-day', 'World Engineering Day', 'education', 'superior', 'minor', [3, 4]],
  ['poetry-day', 'World Poetry Day', 'education', 'both', 'minor', [3, 21]],
  ['creativity-day', 'World Creativity and Innovation Day', 'education', 'both', 'minor', [4, 21]],
  ['philosophy-day', 'World Philosophy Day', 'education', 'both', 'minor', { m: 11, n: 3, wd: 4 }],
  ['computer-literacy', 'World Computer Literacy Day', 'education', 'superior', 'minor', [12, 2]],
  ['arabic-language', 'World Arabic Language Day', 'education', 'both', 'minor', [12, 18]],

  ['data-privacy', 'Data Privacy Day', 'law', 'law', 'minor', [1, 28]],
  ['zero-discrimination', 'Zero Discrimination Day', 'law', 'law', 'minor', [3, 1]],
  ['women-judges', 'International Day of Women Judges', 'law', 'law', 'minor', [3, 10]],
  ['right-to-truth', 'International Day for the Right to the Truth', 'law', 'law', 'minor', [3, 24]],
  ['elder-abuse', 'World Elder Abuse Awareness Day', 'law', 'law', 'minor', [6, 15]],
  ['victims-torture', 'International Day in Support of Victims of Torture', 'law', 'law', 'minor', [6, 26]],
  ['parliamentarism', 'International Day of Parliamentarism', 'law', 'law', 'minor', [6, 30]],
  ['mandela-day', 'Nelson Mandela International Day', 'law', 'both', 'minor', [7, 18]],
  ['non-violence', 'International Day of Non-Violence', 'law', 'both', 'minor', [10, 2]],
  ['death-penalty', 'World Day Against the Death Penalty', 'law', 'law', 'minor', [10, 10]],
  ['poverty-day', 'International Day for the Eradication of Poverty', 'law', 'both', 'minor', [10, 17]],
  ['journalists-impunity', 'International Day to End Impunity for Crimes Against Journalists', 'law', 'law', 'minor', [11, 2]],
  ['palestine-solidarity', 'International Day of Solidarity with the Palestinian People', 'law', 'both', 'minor', [11, 29]],
  ['abolition-slavery', 'International Day for the Abolition of Slavery', 'law', 'law', 'minor', [12, 2]],
  ['voters-day', 'National Voters\' Day', 'law', 'both', 'minor', [12, 7]],
  ['migrants-day', 'International Migrants Day', 'law', 'law', 'minor', [12, 18]],
  ['human-solidarity', 'International Human Solidarity Day', 'law', 'both', 'minor', [12, 20]],

  ['hearing-day', 'World Hearing Day', 'health', 'superior', 'minor', [3, 3]],
  ['kidney-day', 'World Kidney Day', 'health', 'superior', 'minor', { m: 3, n: 2, wd: 4 }],
  ['oral-health', 'World Oral Health Day', 'health', 'superior', 'minor', [3, 20]],
  ['down-syndrome', 'World Down Syndrome Day', 'health', 'superior', 'minor', [3, 21]],
  ['malaria-day', 'World Malaria Day', 'health', 'superior', 'minor', [4, 25]],
  ['hand-hygiene', 'World Hand Hygiene Day', 'health', 'superior', 'minor', [5, 5]],
  ['thalassemia', 'World Thalassemia Day', 'health', 'superior', 'minor', [5, 8]],
  ['red-cross', 'World Red Cross and Red Crescent Day', 'health', 'both', 'minor', [5, 8]],
  ['hypertension', 'World Hypertension Day', 'health', 'superior', 'minor', [5, 17]],
  ['food-safety', 'World Food Safety Day', 'health', 'superior', 'minor', [6, 7]],
  ['breastfeeding-week', 'World Breastfeeding Week begins', 'health', 'superior', 'minor', [8, 1]],
  ['mosquito-day', 'World Mosquito Day', 'health', 'superior', 'minor', [8, 20]],
  ['physiotherapy', 'World Physiotherapy Day', 'health', 'superior', 'minor', [9, 8]],
  ['patient-safety', 'World Patient Safety Day', 'health', 'superior', 'minor', [9, 17]],
  ['alzheimers', 'World Alzheimer\'s Day', 'health', 'superior', 'minor', [9, 21]],
  ['rabies-day', 'World Rabies Day', 'health', 'superior', 'minor', [9, 28]],
  ['sight-day', 'World Sight Day', 'health', 'superior', 'minor', { m: 10, n: 2, wd: 4 }],
  ['arthritis-day', 'World Arthritis Day', 'health', 'superior', 'minor', [10, 12]],
  ['osteoporosis', 'World Osteoporosis Day', 'health', 'superior', 'minor', [10, 20]],
  ['stroke-day', 'World Stroke Day', 'health', 'superior', 'minor', [10, 29]],
  ['pneumonia-day', 'World Pneumonia Day', 'health', 'superior', 'minor', [11, 12]],
  ['health-coverage', 'Universal Health Coverage Day', 'health', 'superior', 'minor', [12, 12]],

  ['braille-day', 'World Braille Day', 'world', 'both', 'minor', [1, 4]],
  ['happiness-day', 'International Day of Happiness', 'world', 'both', 'minor', [3, 20]],
  ['sport-day', 'International Day of Sport for Development and Peace', 'world', 'both', 'minor', [4, 6]],
  ['art-day', 'World Art Day', 'world', 'both', 'minor', [4, 15]],
  ['heritage-day', 'World Heritage Day', 'world', 'both', 'minor', [4, 18]],
  ['families-day', 'International Day of Families', 'world', 'both', 'minor', [5, 15]],
  ['telecom-day', 'World Telecommunication and Information Society Day', 'world', 'superior', 'minor', [5, 17]],
  ['parents-day', 'Global Day of Parents', 'world', 'both', 'minor', [6, 1]],
  ['oceans-day', 'World Oceans Day', 'world', 'superior', 'minor', [6, 8]],
  ['olympic-day', 'International Olympic Day', 'world', 'both', 'minor', [6, 23]],
  ['social-media-day', 'Social Media Day', 'world', 'both', 'minor', [6, 30]],
  ['malala-day', 'Malala Day', 'world', 'both', 'minor', [7, 12]],
  ['friendship-day', 'International Day of Friendship', 'world', 'both', 'minor', [7, 30]],
  ['charity-day', 'International Day of Charity', 'world', 'both', 'minor', [9, 5]],
  ['ozone-day', 'World Ozone Day', 'world', 'superior', 'minor', [9, 16]],
  ['older-persons', 'International Day of Older Persons', 'world', 'both', 'minor', [10, 1]],
  ['animal-day', 'World Animal Day', 'world', 'superior', 'minor', [10, 4]],
  ['smile-day', 'World Smile Day', 'world', 'both', 'minor', { m: 10, n: 1, wd: 5 }],
  ['post-day', 'World Post Day', 'world', 'superior', 'minor', [10, 9]],
  ['disaster-reduction', 'International Day for Disaster Risk Reduction', 'world', 'both', 'minor', [10, 13]],
  ['kindness-day', 'World Kindness Day', 'world', 'both', 'minor', [11, 13]],
  ['mens-day', 'International Men\'s Day', 'world', 'both', 'minor', [11, 19]],
  ['television-day', 'World Television Day', 'world', 'both', 'minor', [11, 21]],
  ['mountain-day', 'International Mountain Day', 'world', 'superior', 'minor', [12, 11]]
].map(function (e) {
  return { id: e[0], title: e[1], cat: e[2], college: e[3], size: e[4], rule: e[5] };
});

/* Expected dates in Pakistan where they differ from the calculation (checked October 2026). */
var ISLAMIC_OVERRIDES = {
  'ramadan-start@2027': '2027-02-08'
};

/* Things that belong to a month but have no fixed date. */
var MONTH_WINDOWS = [
  { id: 'w-exam-schedule', m: 1, college: 'superior', text: 'Punjab boards usually announce the year\'s exam and result schedule this month. Check and add the dates.' },
  { id: 'w-inter-supp-result', m: 1, college: 'superior', text: 'Intermediate supplementary result usually comes this month. Date to confirm.' },
  { id: 'w-lat-1', m: 1, college: 'law', text: 'Law Admission Test is usually held this month. Date to confirm with the Higher Education Commission.' },
  { id: 'w-matric-exams', m: 3, college: 'superior', text: 'Matric annual exams usually start this month. Date to confirm.' },
  { id: 'w-lat-4', m: 4, college: 'law', text: 'Law Admission Test is usually held this month. Date to confirm with the Higher Education Commission.' },
  { id: 'w-inter-exams', m: 5, college: 'superior', text: 'Intermediate annual exams usually start this month. Date to confirm.' },
  { id: 'w-summer-vacation', m: 6, college: 'both', text: 'Summer vacation usually starts around the beginning of this month. Dates to confirm.' },
  { id: 'w-lat-6', m: 6, college: 'law', text: 'Law Admission Test is usually held this month. Date to confirm with the Higher Education Commission.' },
  { id: 'w-matric-result', m: 7, college: 'superior', text: 'Matric result usually comes late this month. Date to confirm.' },
  { id: 'w-ninth-result', m: 8, college: 'superior', text: 'Ninth class result usually comes this month. Date to confirm.' },
  { id: 'w-second-year-result', m: 9, college: 'superior', text: 'Intermediate second year result usually comes this month. Date to confirm.' },
  { id: 'w-lat-9', m: 9, college: 'law', text: 'Law Admission Test is usually held this month. Date to confirm with the Higher Education Commission.' },
  { id: 'w-first-year-result', m: 10, college: 'superior', text: 'Intermediate first year result usually comes this month. Date to confirm.' },
  { id: 'w-matric-supp-exams', m: 10, college: 'superior', text: 'Matric supplementary exams usually start this month. Date to confirm.' },
  { id: 'w-breast-cancer', m: 10, college: 'both', text: 'Breast Cancer Awareness Month (whole month).' },
  { id: 'w-inter-supp-exams', m: 11, college: 'superior', text: 'Intermediate supplementary exams usually start this month. Date to confirm.' },
  { id: 'w-lat-11', m: 11, college: 'law', text: 'Law Admission Test is usually held this month. Date to confirm with the Higher Education Commission.' },
  { id: 'w-matric-supp-result', m: 12, college: 'superior', text: 'Matric supplementary result usually comes this month. Date to confirm.' },
  { id: 'w-winter-vacation', m: 12, college: 'both', text: 'Winter vacation in Punjab colleges usually starts around 22 or 23 December and runs to about 10 January. Wait for the notification.' }
];


/* ---------- Planner engine: dates, rules, filtering ---------- */
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
function ymKey(y, m) { return y + '-' + pad2(m); }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function weekdayOf(y, m, d) { return new Date(y, m - 1, d).getDay(); }
function parseYmd(s) { var p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
function longDate(s) { var p = parseYmd(s); return DAY_NAMES[weekdayOf(p.y, p.m, p.d)] + ', ' + p.d + ' ' + MONTH_NAMES[p.m - 1] + ' ' + p.y; }
function addMonths(y, m, n) { var t = (y * 12 + (m - 1)) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
function shiftDate(date, n) { var p = parseYmd(date), d = new Date(p.y, p.m - 1, p.d + n); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function newId() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* Islamic date of a Gregorian day (Saudi Umm al-Qura calendar). */
var _hijriFmt = null, _hijriOk = null;
function hijriOf(y, m, d) {
  if (_hijriOk === false) return null;
  try {
    if (!_hijriFmt) _hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    var parts = _hijriFmt.formatToParts(new Date(Date.UTC(y, m - 1, d, 12)));
    var out = {};
    parts.forEach(function (p) { if (p.type === 'month') out.m = +p.value; if (p.type === 'day') out.d = +p.value; if (p.type === 'year') out.y = +p.value; });
    if (_hijriOk === null) _hijriOk = !!(out.m && out.d && out.y && out.y < 1700);
    return _hijriOk ? out : null;
  } catch (e) { _hijriOk = false; return null; }
}

/* All dates in a year on which a rule falls. */
function datesForRule(rule, year) {
  if (Array.isArray(rule)) {
    if (rule[1] > daysInMonth(year, rule[0])) return [];
    return [ymd(year, rule[0], rule[1])];
  }
  if (rule.date) { return rule.date.slice(0, 4) === String(year) ? [rule.date] : []; }
  if (rule.wk !== undefined) {
    var all = [];
    for (var mm = 1; mm <= 12; mm++) for (var dd = 1, nn = daysInMonth(year, mm); dd <= nn; dd++) if (weekdayOf(year, mm, dd) === rule.wk) all.push(ymd(year, mm, dd));
    return all;
  }
  if (rule.wd !== undefined) {
    var first = weekdayOf(year, rule.m, 1);
    var day = 1 + ((rule.wd - first + 7) % 7) + (rule.n - 1) * 7;
    return day <= daysInMonth(year, rule.m) ? [ymd(year, rule.m, day)] : [];
  }
  if (rule.h) {
    /* Pakistan usually falls one day after the Saudi calendar, so look at the day before. */
    var out = [];
    for (var m = 1; m <= 12; m++) {
      for (var d = 1, n = daysInMonth(year, m); d <= n; d++) {
        var prev = new Date(Date.UTC(year, m - 1, d - 1, 12));
        var h = hijriOf(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
        if (h && h.m === rule.h[0] && h.d === rule.h[1]) out.push(ymd(year, m, d));
      }
    }
    return out;
  }
  return [];
}

/* Build every item for a year: built-in events, own events, birthdays. */
var _yearCache = {};
function clearCache() { _yearCache = {}; }

function allEventDefs(state) {
  var defs = BUILTIN_EVENTS.map(function (e) {
    var ed = state.edits[e.id] || {};
    return {
      id: e.id, kind: 'builtin', rule: e.rule,
      title: ed.title || e.title, cat: ed.cat || e.cat, college: ed.college || e.college, size: ed.size || e.size,
      hidden: !!state.hidden[e.id], tentative: !!(e.rule && e.rule.h), weekly: !!(e.rule && e.rule.wk !== undefined)
    };
  });
  state.custom.forEach(function (c) {
    defs.push({
      id: c.id, kind: 'custom', rule: c.repeat ? [c.m, c.d] : { date: c.date },
      title: c.title, cat: c.cat, college: c.college, size: c.size, hidden: false, tentative: false, repeat: !!c.repeat,
      days: Math.max(1, Math.min(60, Math.round(Number(c.days) || 1)))
    });
  });
  return defs;
}

function buildYear(year, state) {
  if (_yearCache[year]) return _yearCache[year];
  var map = {};
  function put(date, item) { (map[date] = map[date] || []).push(item); }
  allEventDefs(state).forEach(function (def) {
    if (def.hidden) return;
    var key = def.id + '@' + year, span = def.days || 1;
    var dates;
    if (state.moved[key] && !def.weekly) dates = [state.moved[key]];
    else if (def.kind === 'builtin' && ISLAMIC_OVERRIDES[key]) dates = [ISLAMIC_OVERRIDES[key]];
    else {
      dates = datesForRule(def.rule, year);
      /* an event that starts late in the previous year can run into this one */
      if (span > 1) dates = datesForRule(def.rule, year - 1).concat(dates);
    }
    dates.forEach(function (start) {
      for (var k = 0; k < span; k++) {
        var date = k ? shiftDate(start, k) : start;
        if (date.slice(0, 4) !== String(year)) continue;
        put(date, {
          id: def.id, kind: def.kind, title: def.title + (span > 1 ? ' (day ' + (k + 1) + ' of ' + span + ')' : ''), baseTitle: def.title,
          cat: def.cat, college: def.college, size: def.size,
          tentative: def.tentative && !state.moved[key], date: date, start: start, days: span, repeat: def.repeat, weekly: !!def.weekly
        });
      }
    });
  });
  state.birthdays.forEach(function (b) {
    if (b.d > daysInMonth(year, b.m)) return;
    put(ymd(year, b.m, b.d), {
      id: b.id, kind: 'birthday', title: 'Birthday: ' + b.name, name: b.name, dept: b.dept || '',
      cat: 'birthday', college: 'superior', size: 'minor', tentative: false, date: ymd(year, b.m, b.d)
    });
  });
  var order = { major: 0, minor: 1 };
  Object.keys(map).forEach(function (k) {
    map[k].sort(function (a, b) {
      var ab = a.kind === 'birthday' ? 1 : 0, bb = b.kind === 'birthday' ? 1 : 0;
      if (ab !== bb) return ab - bb;
      if (order[a.size] !== order[b.size]) return order[a.size] - order[b.size];
      if (!!a.weekly !== !!b.weekly) return a.weekly ? 1 : -1;
      return a.title < b.title ? -1 : 1;
    });
  });
  _yearCache[year] = map;
  return map;
}

function collegeMatches(itemCollege, filter) {
  return filter === 'both' || itemCollege === 'both' || itemCollege === filter;
}

/* Items for one date, filtered by college and by the categories switched on. */
function itemsOn(date, state, filter, cats) {
  var list = buildYear(+date.slice(0, 4), state)[date] || [];
  return list.filter(function (it) {
    if (!collegeMatches(it.college, filter)) return false;
    if (cats && cats[it.cat] === false) return false;
    return true;
  });
}

/* Title as it should read on a sheet. */
function printTitle(it, filter) {
  var t = it.title;
  if (it.tentative) t += ' (tentative)';
  if (filter === 'both' && it.cat === 'college' && it.college !== 'both') t += ' (' + COLLEGES[it.college].name + ')';
  return t;
}

/* Month-level notes: built-in "usually this month" items plus the user's own. */
function notesFor(y, m, state, filter) {
  var key = ymKey(y, m), out = [];
  MONTH_WINDOWS.forEach(function (w) {
    if (w.m !== m) return;
    if (state.dismissed[w.id + '@' + y]) return;
    if (!collegeMatches(w.college, filter)) return;
    out.push({ id: w.id, builtin: true, text: w.text, college: w.college });
  });
  state.notes.forEach(function (n) {
    if (n.ym !== key) return;
    if (!collegeMatches(n.college, filter)) return;
    out.push({ id: n.id, builtin: false, text: n.text, college: n.college });
  });
  return out;
}

/* Planned this year but no month chosen yet. */
function undatedNotes(state, filter) {
  return state.notes.filter(function (n) { return n.ym === 'any' && collegeMatches(n.college, filter); })
    .map(function (n) { return { id: n.id, builtin: false, undated: true, text: n.text, college: n.college }; });
}

/* Weeks of a month, Sunday first. Each cell: {y,m,d,date,inMonth}. */
function monthWeeks(y, m, fixedSix) {
  var first = weekdayOf(y, m, 1), n = daysInMonth(y, m);
  var cells = [], i;
  var prev = addMonths(y, m, -1), next = addMonths(y, m, 1), pn = daysInMonth(prev.y, prev.m);
  for (i = first - 1; i >= 0; i--) cells.push({ y: prev.y, m: prev.m, d: pn - i, inMonth: false });
  for (i = 1; i <= n; i++) cells.push({ y: y, m: m, d: i, inMonth: true });
  var nd = 1;
  while (cells.length % 7 !== 0 || (fixedSix && cells.length < 42)) cells.push({ y: next.y, m: next.m, d: nd++, inMonth: false });
  var weeks = [];
  for (i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7).map(function (c) { c.date = ymd(c.y, c.m, c.d); return c; }));
  }
  return weeks;
}

function defaultState() {
  return { v: 1, custom: [], hidden: {}, edits: {}, moved: {}, dismissed: {}, birthdays: [], notes: [] };
}

function normaliseState(s) {
  var d = defaultState();
  if (!s || typeof s !== 'object') return d;
  ['custom', 'birthdays', 'notes'].forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
  ['hidden', 'edits', 'moved', 'dismissed'].forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
  delete s.cats; delete s.filter;
  s.v = 1;
  return s;
}
/* WhatsWork core: calendars, events, clashes, the 24-hour split, posts and briefings.
   Shared by the app and the background worker. Needs planner-core.js loaded first.
   All times are wall-clock minutes on the local clock (day number * 1440 + minutes),
   so there is no time-zone maths here: the app and the worker both work in the owner's local time. */
var WWCore = (function () {
  var DAY = 1440;

  var KINDS = {
    sleep: { label: 'Sleep', color: '#6c7bd0' },
    shift: { label: 'Shift', color: '#3157e8' },
    university: { label: 'University', color: '#0e9f6e' },
    work: { label: 'Work', color: '#e0812a' },
    meeting: { label: 'Meeting', color: '#d6336c' },
    call: { label: 'Call', color: '#c2410c' },
    personal: { label: 'Personal', color: '#7c5cff' },
    post: { label: 'Post (all day)', color: '#64748b' }
  };
  /* what wins a minute when two things overlap, for the 24-hour split */
  var PRIORITY = { meeting: 7, call: 7, shift: 6, university: 5, work: 4, personal: 3, other: 2, sleep: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dnum(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function dstr(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function weekday(n) { return new Date(n * 864e5).getUTCDay(); }
  function tmin(t) { if (t == null || t === '') return null; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function addDays(s, k) { return dstr(dnum(s) + k); }
  function fmtTime(m) {
    m = ((m % DAY) + DAY) % DAY;
    var h = Math.floor(m / 60), mi = m % 60, ap = h < 12 ? 'am' : 'pm', h12 = h % 12 || 12;
    return h12 + (mi ? ':' + pad(mi) : '') + ' ' + ap;
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h && m ? h + 'h ' + m + 'm' : h ? h + 'h' : m + 'm';
  }

  /* ---------- occurrences ---------- */
  /* Every occurrence touching the days from..to (inclusive). An overnight block that starts the
     evening before `from` is included, so a night shift shows on the morning it ends. */
  function occurrences(events, calendars, from, to) {
    var cal = {}; calendars.forEach(function (c) { cal[c.id] = c; });
    var a = dnum(from) - 1, b = dnum(to), out = [];
    events.forEach(function (ev) {
      var c = cal[ev.calendar_id]; if (!c) return;
      var first = dnum(ev.date), until = ev.repeat_until ? dnum(ev.repeat_until) : Infinity;
      var skips = {}; (ev.skip_dates || []).forEach(function (s) { skips[s] = 1; });
      var days = ev.repeat_days && ev.repeat_days.length ? ev.repeat_days : [weekday(first)];
      function push(n) {
        var s = tmin(ev.start_time), e = tmin(ev.end_time), allDay = s == null;
        var st = allDay ? n * DAY : n * DAY + s;
        var en = allDay ? (n + 1) * DAY : n * DAY + (e == null ? s + 60 : (e > s ? e : e + DAY));
        out.push({ key: ev.id + '@' + dstr(n), ev: ev, cal: c, kind: ev.kind || 'other', date: dstr(n), start: st, end: en, allDay: allDay });
      }
      if (!ev.repeat || ev.repeat === 'none') { if (first >= a && first <= b) push(first); return; }
      for (var n = Math.max(a, first); n <= Math.min(b, until); n++) {
        if (skips[dstr(n)]) continue;
        if (ev.repeat === 'weekly' && days.indexOf(weekday(n)) < 0) continue;
        push(n);
      }
    });
    out.sort(function (x, y) { return x.start - y.start || y.end - x.end; });
    return out;
  }
  function timed(occs) { return occs.filter(function (o) { return !o.allDay && o.kind !== 'post'; }); }

  /* ---------- clashes and short sleep ---------- */
  function overlap(a, b) { return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)); }
  /* a meeting inside your own shift on the same calendar is part of the shift, not a clash */
  function partOfShift(a, b) { return a.cal.id === b.cal.id && (a.kind === 'shift' || b.kind === 'shift'); }

  function analyse(occs) {
    var t = timed(occs), clashes = [], shortSleep = [], flagged = {};
    var busy = t.filter(function (o) { return o.kind !== 'sleep'; });
    for (var i = 0; i < busy.length; i++) for (var j = i + 1; j < busy.length; j++) {
      var a = busy[i], b = busy[j];
      if (b.start >= a.end) continue;
      if (overlap(a, b) <= 0 || partOfShift(a, b)) continue;
      clashes.push({ a: a, b: b, start: Math.max(a.start, b.start), end: Math.min(a.end, b.end), date: dstr(Math.floor(Math.max(a.start, b.start) / DAY)) });
      flagged[a.key] = flagged[b.key] = 1;
    }
    t.filter(function (o) { return o.kind === 'sleep'; }).forEach(function (s) {
      var cut = [], lost = minutesCovered(busy.map(function (o) {
        var lo = Math.max(o.start, s.start), hi = Math.min(o.end, s.end);
        if (hi > lo) cut.push(o);
        return [lo, hi];
      }).filter(function (r) { return r[1] > r[0]; }));
      var left = (s.end - s.start) - lost;
      if (lost > 0 && left < 360) { shortSleep.push({ sleep: s, left: left, by: cut, date: s.date }); flagged[s.key] = 1; }
    });
    return { clashes: clashes, shortSleep: shortSleep, flagged: flagged };
  }
  function minutesCovered(ranges) {
    ranges.sort(function (x, y) { return x[0] - y[0]; });
    var total = 0, cs = -1, ce = -1;
    ranges.forEach(function (r) {
      if (r[0] > ce) { if (ce > cs) total += ce - cs; cs = r[0]; ce = r[1]; } else if (r[1] > ce) ce = r[1];
    });
    if (ce > cs) total += ce - cs;
    return total;
  }

  /* ---------- the 24-hour split for one day ---------- */
  function groupOf(o) {
    if (o.kind === 'sleep') return { id: 'sleep', label: 'Sleep', color: KINDS.sleep.color };
    if (o.kind === 'shift') return { id: 'shift', label: 'Shift', color: o.cal.color };
    if (o.kind === 'university') return { id: 'university', label: 'University', color: KINDS.university.color };
    if (o.kind === 'meeting' || o.kind === 'call') return { id: 'meetings', label: 'Meetings and calls', color: KINDS.meeting.color };
    return { id: 'cal:' + o.cal.id, label: o.cal.name, color: o.cal.color };
  }
  /* Minute by minute: each minute goes to the most important thing happening then; the rest is free. */
  function daySplit(date, occs) {
    var d0 = dnum(date) * DAY, slots = new Array(DAY), pr = new Array(DAY);
    timed(occs).forEach(function (o) {
      var lo = Math.max(o.start, d0) - d0, hi = Math.min(o.end, d0 + DAY) - d0, p = PRIORITY[o.kind] || 2;
      for (var m = lo; m < hi; m++) if (!slots[m] || p > pr[m]) { slots[m] = o; pr[m] = p; }
    });
    var groups = {}, byCal = {}, order = [];
    for (var m = 0; m < DAY; m++) {
      var o = slots[m], g = o ? groupOf(o) : { id: 'free', label: 'Free', color: '' };
      if (!groups[g.id]) { groups[g.id] = { id: g.id, label: g.label, color: g.color, minutes: 0 }; order.push(g.id); }
      groups[g.id].minutes++;
      if (o && o.kind !== 'sleep') byCal[o.cal.id] = (byCal[o.cal.id] || 0) + 1;
    }
    var list = order.map(function (k) { return groups[k]; }).sort(function (x, y) {
      if (x.id === 'free') return 1; if (y.id === 'free') return -1; return y.minutes - x.minutes;
    });
    /* the bar in time order: consecutive runs of the same group */
    var runs = [], cur = null;
    for (m = 0; m < DAY; m++) {
      var gid = slots[m] ? groupOf(slots[m]).id : 'free';
      if (cur && cur.id === gid) cur.len++; else { cur = { id: gid, start: m, len: 1, color: groups[gid].color, label: groups[gid].label }; runs.push(cur); }
    }
    return { groups: list, byCal: byCal, runs: runs };
  }

  /* ---------- posts ---------- */
  var _worldCache = {}, _plannerCacheKey = '';
  /* Built-in days only (no college edits, birthdays or own events), for calendars that follow world days. */
  function builtinItemsOn(date) {
    var saved = _yearCache; _yearCache = _worldCache;
    var list = buildYear(+date.slice(0, 4), defaultState())[date] || [];
    _worldCache = _yearCache; _yearCache = saved;
    return list;
  }
  function trackOf(tracks, key, date) { var m = tracks && tracks[date.slice(0, 7)]; return (m && m[key]) || {}; }
  function statusFrom(tr) { return { sent: !!tr.q || !!tr.sent, made: !!tr.m || !!tr.made, scheduled: !!tr.s || !!tr.scheduled, skip: !!tr.skip }; }

  /* ctx = { planner: normalised planner state or null, tracks: {'YYYY-MM': map}, calendars, postStatus: {calId: {key: row}}, occs } */
  function postsOn(date, ctx) {
    var out = [];
    ctx.calendars.forEach(function (c) {
      if (c.archived) return;
      if (c.kind === 'planner' && ctx.planner && c.planner_college) {
        itemsOn(date, ctx.planner, c.planner_college, null).forEach(function (it) {
          var key = it.id + '@' + date;
          out.push({ cal: c, key: key, source: 'planner', title: it.title, cat: it.cat, status: statusFrom(trackOf(ctx.tracks, key, date)), shared: it.college === 'both' });
        });
      }
      if (c.follows_world_days) {
        var cats = c.world_cats && c.world_cats.length ? c.world_cats : ['world'];
        builtinItemsOn(date).forEach(function (it) {
          if (it.weekly || cats.indexOf(it.cat) < 0) return;
          var key = 'w:' + it.id + '@' + date, st = statusFrom(((ctx.postStatus || {})[c.id] || {})[key] || {});
          if (st.skip) return;
          out.push({ cal: c, key: key, source: 'world', title: it.title, cat: it.cat, status: st });
        });
      }
    });
    (ctx.occs || []).forEach(function (o) {
      if (o.kind !== 'post' || o.date !== date) return;
      var key = 'e:' + o.ev.id + '@' + date;
      out.push({ cal: o.cal, key: key, source: 'event', title: o.ev.title, cat: 'post', status: statusFrom(((ctx.postStatus || {})[o.cal.id] || {})[key] || {}), occ: o });
    });
    return out;
  }
  function statusText(st) { return st.scheduled ? 'scheduled' : st.made ? 'made, not scheduled' : st.sent ? 'with designer' : 'not started'; }
  /* The same post on two calendars with the same status reads as one line. */
  function mergePosts(posts) {
    var lines = [], by = {};
    posts.forEach(function (p) {
      var k = p.title + '|' + statusText(p.status);
      if (by[k]) { by[k].cals.push(p.cal); return; }
      by[k] = { title: p.title, status: p.status, cals: [p.cal] }; lines.push(by[k]);
    });
    return lines;
  }

  /* ---------- briefings ---------- */
  function shortName(c) { return c.short_name || c.name; }
  /* slot 'am' = the morning check for today, 'pm' = the evening heads-up for tomorrow */
  function briefing(date, slot, ctx) {
    var posts = postsOn(date, ctx), lines = mergePosts(posts), body = [];
    var notReady = posts.filter(function (p) { return !p.status.scheduled; }).length;
    lines.forEach(function (l) {
      body.push((l.status.scheduled ? '✅ ' : '📌 ') + l.title + ' (' + l.cals.map(shortName).join(', ') + '): ' + statusText(l.status));
    });
    var dayOccs = timed(ctx.occs || []).filter(function (o) { return o.date === date; });
    var events = dayOccs.filter(function (o) { return o.kind === 'meeting' || o.kind === 'call' || (!o.ev.repeat || o.ev.repeat === 'none') && o.kind !== 'sleep'; });
    events.forEach(function (o) { body.push('🕑 ' + fmtTime(o.start) + ' ' + o.ev.title + ' (' + shortName(o.cal) + ')'); });
    var an = analyse(ctx.occs || []);
    an.clashes.filter(function (c) { return c.date === date; }).forEach(function (c) {
      body.push('⚠️ Clash at ' + fmtTime(c.start) + ': ' + c.a.ev.title + ' and ' + c.b.ev.title);
    });
    an.shortSleep.filter(function (s) { return s.date === date; }).forEach(function (s) {
      body.push('😴 Sleep cut to ' + fmtDur(Math.max(0, s.left)) + ' by ' + s.by.map(function (o) { return o.ev.title; }).join(', '));
    });
    if (!body.length) return null;
    var when = slot === 'am' ? 'Today' : 'Tomorrow';
    var title = posts.length
      ? (slot === 'am' ? '📅 ' : '🌙 ') + when + ': ' + posts.length + ' post' + (posts.length > 1 ? 's' : '') + (notReady ? ', ' + notReady + ' not scheduled' : ', all scheduled')
      : (slot === 'am' ? '📅 ' : '🌙 ') + when + ': ' + (events.length ? events.length + ' thing' + (events.length > 1 ? 's' : '') + ' planned' : 'check your day');
    var shown = body.slice(0, 8);
    if (body.length > 8) shown.push('+' + (body.length - 8) + ' more in the app');
    return { title: title, body: shown.join('\n'), posts: posts.length, notReady: notReady };
  }

  /* calendars to use when none are set up yet: the two college calendars from the planner */
  function fallbackCalendars() {
    return [
      { id: 'planner-superior', name: 'Superior College', short_name: 'Superior', color: '#0b8a84', kind: 'planner', planner_college: 'superior' },
      { id: 'planner-law', name: 'Allama Iqbal Law College', short_name: 'AILC', color: '#8c1d2f', kind: 'planner', planner_college: 'law' }
    ];
  }

  return {
    DAY: DAY, KINDS: KINDS, dnum: dnum, dstr: dstr, weekday: weekday, tmin: tmin, addDays: addDays, fmtTime: fmtTime, fmtDur: fmtDur,
    occurrences: occurrences, timed: timed, analyse: analyse, daySplit: daySplit, overlap: overlap,
    postsOn: postsOn, statusText: statusText, mergePosts: mergePosts, briefing: briefing, fallbackCalendars: fallbackCalendars,
    resetPlannerCache: function () { clearCache(); }
  };
})();
export { WWCore, normaliseState };
