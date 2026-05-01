import * as XLSX from 'xlsx';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const xlsx = require('xlsx');

const filePath = 'c:\\Users\\Sodham\\OneDrive - Kleza Solutions Pvt Ltd\\Desktop\\Desktop\\Website-testing-agent\\Website Testing Checklist (1).xlsx';
try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    fs.writeFileSync('c:\\Users\\Sodham\\OneDrive - Kleza Solutions Pvt Ltd\\Desktop\\Desktop\\Website-testing-agent\\checklist_data.json', JSON.stringify(data, null, 2));
    console.log('Success: checklist_data.json created');
} catch (err) {
    console.error('Error reading excel:', err);
}
