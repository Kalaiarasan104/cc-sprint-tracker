# Sprint Tracker

Chrome extension for the active sprint on any Atlassian board. Paste the board link in the panel. Jira status sets two flags:

- **Dev done** once the status reaches Development - Done, Testing - To Do, Testing WIP, or any later testing or release status.
- **Released live** when the status is Released Live or Bug Resolved.

Still in dev stays on by default, so the list keeps tracing tickets until that first flag flips. Each ticket can have its own reminder. A Jira due date, when the ticket has one, is shown on the row.

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked and select this folder.
4. Stay signed in to Jira in this same Chrome profile.
5. Click the extension icon. It opens as a side panel.
6. Paste a board link such as `https://yoursite.atlassian.net/jira/software/c/projects/KEY/boards/123` and choose Load.

If Jira returns an auth error, open Settings and add an API token from [Atlassian account security](https://id.atlassian.com/manage-profile/security/api-tokens). Leave the token empty when the signed-in session already works.

## Reminders

On a ticket, use `15m`, `1h`, `2h`, `On due date`, or a custom timer with two boxes side by side. Type a whole number, or open the list: hours from 1 to 70, minutes in steps of 10. Typed minutes can be any whole number. 60 or more rolls into the hours box, and both boxes update. Press Enter or click `Set timer`. Press Enter in either box or click `Set timer`. The row counts down, soonest timer first. `Show clock` opens the floating clock. Close it whenever you like; the timer keeps running. Pause and Resume work from the panel or the clock; a paused timer keeps its remaining time.

The pin icon on the clock keeps it above every other window. Chrome moves it into a Picture-in-Picture window and minimizes the original. The icon fills in while it is pinned. Chrome requires that one click; it cannot pin automatically. Closing the pinned window brings the normal clock back.

At zero, a floating popup lists the ticket, summary, status, assignee, due date, and the dev-done and released-live flags. From there you can snooze 30 minutes, dismiss, or open the ticket. Open ticket switches to the browser window: it activates a tab that already has the ticket, or opens one in your last browser window. The side panel keeps the same alert if you close the popup. Reminders use Chrome alarms, so they still fire after the panel is closed.

## Check the parsers

```bash
node --test tests/parse.test.mjs
```

