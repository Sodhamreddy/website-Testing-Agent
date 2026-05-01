import * as XLSX from 'xlsx';
import type { ChecklistStatus, TestIssue, TestResult } from '../types';

export function exportToExcel(
  issues: TestIssue[],
  result: TestResult | null,
  checklistStatus: ChecklistStatus,
  url: string
) {
  const wb = XLSX.utils.book_new();
  const hostname = (() => { try { return new URL(url).hostname; } catch { return 'site'; } })();
  const dateStr = new Date().toISOString().split('T')[0];

  const countChecks = (status: 'pass' | 'fail' | 'pending') =>
    Object.values(checklistStatus).reduce(
      (a, cat) => a + Object.values(cat).filter(s => s === status).length, 0
    );

  const summaryRows: (string | number)[][] = [
    ['TESTING AGENT - WEBSITE QA REPORT'],
    [''],
    ['Website URL', url],
    ['Generated', new Date().toLocaleString()],
    ['Report Mode', 'Checklist QA - no score / no percentage'],
    [''],
    ['ISSUE SUMMARY', '', ''],
    ['Total Issues', issues.length],
    ['Critical Issues', issues.filter(i => i.severity === 'Critical').length],
    ['Major Issues', issues.filter(i => i.severity === 'Major').length],
    ['Minor Issues', issues.filter(i => i.severity === 'Minor').length],
    ['Fixed Issues', issues.filter(i => i.status === 'Fixed').length],
    [''],
    ['CHECKLIST SUMMARY', '', ''],
    ['Passed Checks', countChecks('pass')],
    ['Failed Checks', countChecks('fail')],
    ['Needs Manual Review', countChecks('pending')],
    [''],
    ['DETECTED PAGE DATA', '', ''],
    ['Page Title', result?.foundData?.title ?? 'Not Found'],
    ['H1 Heading', result?.foundData?.h1 ?? 'Not Found'],
    ['Meta Description', result?.foundData?.description ?? 'Not Found'],
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 24 }, { wch: 70 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  const issueHeaders = [
    '#', 'Issue Name', 'Category', 'Severity', 'Affected Page / Section',
    'Description', 'Steps to Reproduce', 'Context', 'Status',
    'Additional Details', 'Screenshot Evidence',
  ];
  const issueRows = issues.map(i => [
    i.id,
    i.name,
    i.category,
    i.severity,
    i.affectedPage,
    i.description,
    i.steps.replace(/\n/g, ' -> '),
    i.browser,
    i.status,
    (i.details ?? []).join(' | '),
    i.screenshot ? 'Attached in app report' : '',
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet([issueHeaders, ...issueRows]);
  ws2['!cols'] = [
    { wch: 4 }, { wch: 42 }, { wch: 16 }, { wch: 10 }, { wch: 54 },
    { wch: 66 }, { wch: 56 }, { wch: 18 }, { wch: 10 }, { wch: 60 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'All Issues');

  const criticals = issues.filter(i => i.severity === 'Critical');
  if (criticals.length > 0) {
    const critRows: string[][] = [['CRITICAL ISSUES - IMMEDIATE ACTION REQUIRED'], ['']];
    criticals.forEach((issue, idx) => {
      critRows.push([`#${idx + 1}. ${issue.name}`]);
      critRows.push(['Category:', issue.category]);
      critRows.push(['Affected Page:', issue.affectedPage]);
      critRows.push(['Description:', issue.description]);
      critRows.push(['Fix Steps:', issue.steps.replace(/\n/g, ' -> ')]);
      critRows.push(['Status:', issue.status]);
      if (issue.details?.length) critRows.push(['Details:', issue.details.join(' | ')]);
      critRows.push(['']);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(critRows);
    ws3['!cols'] = [{ wch: 20 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Critical Issues');
  }

  const catMap: Record<string, { critical: number; major: number; minor: number }> = {};
  for (const i of issues) {
    if (!catMap[i.category]) catMap[i.category] = { critical: 0, major: 0, minor: 0 };
    if (i.severity === 'Critical') catMap[i.category].critical++;
    else if (i.severity === 'Major') catMap[i.category].major++;
    else catMap[i.category].minor++;
  }
  const catRows = Object.entries(catMap).map(([cat, c]) => [
    cat, c.critical, c.major, c.minor, c.critical + c.major + c.minor,
  ]);
  const ws4 = XLSX.utils.aoa_to_sheet([['Category', 'Critical', 'Major', 'Minor', 'Total'], ...catRows]);
  ws4['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Issues by Category');

  const checkRows: string[][] = [];
  for (const [cat, items] of Object.entries(checklistStatus)) {
    for (const [item, status] of Object.entries(items)) {
      checkRows.push([cat.toUpperCase(), item, status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Manual review']);
    }
  }
  const ws5 = XLSX.utils.aoa_to_sheet([['Category', 'Check Item', 'Status'], ...checkRows]);
  ws5['!cols'] = [{ wch: 18 }, { wch: 58 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'QA Checklist');

  XLSX.writeFile(wb, `TestingAgent_${hostname}_${dateStr}.xlsx`);
}

export function exportToCSV(issues: TestIssue[]) {
  const headers = ['#', 'Issue Name', 'Category', 'Severity', 'Affected Page / Section', 'Description', 'Steps to Reproduce', 'Context', 'Status'];
  const rows = issues.map(i => [
    i.id,
    `"${i.name}"`,
    i.category,
    i.severity,
    `"${i.affectedPage}"`,
    `"${i.description.replace(/"/g, "'")}"`,
    `"${i.steps.replace(/\n/g, ' -> ').replace(/"/g, "'")}"`,
    i.browser,
    i.status,
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `TestingAgent_${new Date().toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
