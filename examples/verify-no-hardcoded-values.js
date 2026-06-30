/**
 * Verification Script: Check for Hardcoded Configuration Values
 * 
 * This script verifies that no hardcoded configuration values remain
 * in the client code after refactoring.
 */

const fs = require('fs');
const path = require('path');

// Patterns to search for (potential hardcoded values)
const patterns = [
  { name: 'Hardcoded URLs', regex: /['"]https:\/\/[^'"]+['"]/g, exclude: ['require', 'import'] },
  { name: 'Hardcoded network strings', regex: /['"](?:testnet|mainnet)['"]/g, exclude: ['===', '!==', 'must be'] },
  { name: 'Hardcoded fee values', regex: /\b(?:250|10000)\b/g, exclude: ['0-10000', 'between', 'must be'] },
  { name: 'CONFIG object definition', regex: /const\s+CONFIG\s*=/g, exclude: [] },
];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const issues = [];

  patterns.forEach(pattern => {
    const matches = content.match(pattern.regex);
    if (matches) {
      matches.forEach(match => {
        // Find line number
        let lineNum = 0;
        let charCount = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineContent = lines[i];
          if (charCount + lineContent.length >= content.indexOf(match, charCount)) {
            lineNum = i + 1;
            
            // Check if this line should be excluded
            const shouldExclude = pattern.exclude.some(excludeText => 
              lineContent.includes(excludeText)
            );
            
            // Also exclude comments
            const isComment = lineContent.trim().startsWith('//') || 
                            lineContent.trim().startsWith('*') ||
                            lineContent.trim().startsWith('/*');
            
            if (!shouldExclude && !isComment) {
              issues.push({
                pattern: pattern.name,
                match,
                line: lineNum,
                content: lineContent.trim()
              });
            }
            break;
          }
          charCount += lineContent.length + 1; // +1 for newline
        }
      });
    }
  });

  return issues;
}

// Check client-example.js
console.log('🔍 Checking for hardcoded configuration values...\n');

const clientFile = path.join(__dirname, 'client-example.js');
const issues = checkFile(clientFile);

if (issues.length === 0) {
  console.log('✅ No hardcoded configuration values found!');
  console.log('✅ All configuration is properly externalized to config.js');
  process.exit(0);
} else {
  console.log('⚠️  Potential hardcoded values found:\n');
  issues.forEach(issue => {
    console.log(`  ${issue.pattern}:`);
    console.log(`    Line ${issue.line}: ${issue.match}`);
    console.log(`    Context: ${issue.content}`);
    console.log('');
  });
  console.log(`Found ${issues.length} potential issue(s)`);
  console.log('Please review these manually to confirm they are not configuration values.');
  process.exit(1);
}
