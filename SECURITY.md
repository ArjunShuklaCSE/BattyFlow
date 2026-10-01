# Security

BattyFlow handles your voice, records which window you're typing in, writes to your clipboard and installs a keyboard hook for push-to-talk. Problems in any of those areas matter, and so does anything that makes the app reach the network without you asking.

## Reporting

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/ArjunShuklaCSE/BattyFlow/security/advisories/new) rather than a public issue. Include the version, what you found, and steps to reproduce it. You'll get a reply within a week, and credit in the release notes if you'd like it.

## In scope

- Audio, transcripts or history leaving the machine, or being readable by other user accounts
- Network requests the user didn't start, or downloads that skip hash verification
- Pasting into a window other than the one the dictation started in, or into password fields
- The keyboard hook observing or reporting keys beyond the push-to-talk combination
- A renderer escaping its sandbox or calling IPC channels outside its role
- Code execution through settings, vocabulary or manifest files

## Supported versions

Only the latest release gets fixes.
