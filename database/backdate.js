// TESTING TOOL: moves an issue's dates into the past so the book becomes overdue.
// Usage: node database/backdate.js <issue_id> <days>
require('dotenv').config();
const { connectDB, mongoose } = require('../config/database');
const { Issue } = require('../models');
const { addDays } = require('../utils/library');

const issueId = Number(process.argv[2]);
const days = Number(process.argv[3]);

if (!issueId || !days) {
  console.log('Usage: node database/backdate.js <issue_id> <days>');
  process.exit(1);
}

(async () => {
  await connectDB();

  const issue = await Issue.findOne({ issue_id: issueId }).lean();
  if (!issue) {
    console.log('Issue not found');
  } else {
    await Issue.updateOne({ issue_id: issueId }, {
      $set: { issue_date: addDays(issue.issue_date, -days), due_date: addDays(issue.due_date, -days) }
    });
    console.log(`Issue ${issueId} moved ${days} days into the past.`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
