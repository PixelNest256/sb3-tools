// Test new compression features: dead assets, write-only, type normalization

const fs = require('fs');
const path = require('path');
const JSZip = require('../../docs/sb3/jszip.min.js');
const SB3 = require('../../docs/sb3/compressor.js');

async function testNewFeatures() {
  console.log('Testing new compression features...\n');

  // Load test project
  const inputPath = 'C:/Users/Kasam/Playground/sb3_compressor/test.sb3';
  const input = fs.readFileSync(inputPath);
  const zip = await JSZip.loadAsync(input);
  const projectJson = await zip.file('project.json').async('string');
  const project = JSON.parse(projectJson);

  console.log('Original project:');
  console.log(`  Targets: ${project.targets.length}`);
  let totalCostumes = 0, totalSounds = 0;
  for (const tgt of project.targets) {
    totalCostumes += (tgt.costumes || []).length;
    totalSounds += (tgt.sounds || []).length;
  }
  console.log(`  Total costumes: ${totalCostumes}`);
  console.log(`  Total sounds: ${totalSounds}`);

  // Test removeDeadAssets
  console.log('\n--- Test 1: removeDeadAssets ---');
  const options1 = new SB3.Options({ removeDeadAssets: true });
  const result1 = SB3.compressProject(JSON.parse(JSON.stringify(project)), options1, () => {});
  console.log(`Dead costumes removed: ${result1.stats.dead_costumes_removed}`);
  console.log(`Dead sounds removed: ${result1.stats.dead_sounds_removed}`);
  console.log(`Dead sprites removed: ${result1.stats.dead_sprites_removed}`);

  // Test removeWriteOnly
  console.log('\n--- Test 2: removeWriteOnly ---');
  const options2 = new SB3.Options({ removeWriteOnly: true });
  const result2 = SB3.compressProject(JSON.parse(JSON.stringify(project)), options2, () => {});
  console.log(`Write-only variables removed: ${result2.stats.writeonly_vars_removed}`);
  console.log(`Write-only lists removed: ${result2.stats.writeonly_lists_removed}`);

  // Test normalizeTypes
  console.log('\n--- Test 3: normalizeTypes ---');
  const options3 = new SB3.Options({ normalizeTypes: true });
  const result3 = SB3.compressProject(JSON.parse(JSON.stringify(project)), options3, () => {});
  console.log(`md5ext removed: ${result3.stats.md5ext_removed}`);
  console.log(`Numeric strings normalized: ${result3.stats.numeric_strings_normalized}`);
  console.log(`meta.agent cleared: ${result3.stats.meta_agent_cleared}`);

  // Test all together
  console.log('\n--- Test 4: All new features together ---');
  const options4 = new SB3.Options({
    removeDeadAssets: true,
    removeWriteOnly: true,
    normalizeTypes: true
  });
  const result4 = SB3.compressProject(JSON.parse(JSON.stringify(project)), options4, () => {});
  console.log(`Dead costumes removed: ${result4.stats.dead_costumes_removed}`);
  console.log(`Dead sounds removed: ${result4.stats.dead_sounds_removed}`);
  console.log(`Dead sprites removed: ${result4.stats.dead_sprites_removed}`);
  console.log(`Write-only variables removed: ${result4.stats.writeonly_vars_removed}`);
  console.log(`Write-only lists removed: ${result4.stats.writeonly_lists_removed}`);
  console.log(`md5ext removed: ${result4.stats.md5ext_removed}`);
  console.log(`Numeric strings normalized: ${result4.stats.numeric_strings_normalized}`);
  console.log(`meta.agent cleared: ${result4.stats.meta_agent_cleared}`);

  console.log('\nAll tests completed.');
}

testNewFeatures().catch(console.error);
