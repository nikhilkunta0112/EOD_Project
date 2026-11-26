const defaults = {
  sender: "", overall: "", project: "",
  projects: [], zone: "local"
};
const defaultTemplates = {
  overall: {
    subject: "EOD Status Update - {{date}}",
    body: "Hi {{recipient}},\n\nPlease find my end-of-day work summary below.\n\nDate: {{date}}\n\n{{updates}}\n\nBest regards,\n{{sender}}"
  },
  project: {
    subject: "EOD Status Update - {{projects}} - {{date}}",
    body: "Hi {{recipient}},\n\nPlease find my end-of-day update for {{projects}} below.\n\nDate: {{date}}\n\n{{updates}}\n\nBest regards,\n{{sender}}"
  }
};
