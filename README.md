# Big Guy's Carwash — V88

Schedule draft persistence and saved-week edit reliability fix.

- CREATE SCHEDULE draft survives navigation.
- Selected week and schedule mode are restored when returning.
- SCHEDULED saved weeks use a confirmed Firestore weeklySchedules write.
- EDIT loads the exact saved week; UPDATE writes back to that same week.
- No attendance/sales/payroll/face data reset.
