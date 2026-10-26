// 検証: メニューのシャドウブロックをtextプリミティブに置換
// 提案1: looks_costume, motion_goto_menu, sound_sounds_menu, sensing_touchingobjectmenu など

const fs = require('fs');
const JSZip = require('../../docs/sb3/jszip.min.js');
const SB3 = require('../../docs/sb3/compressor.js');

async function testMenuShadowToText() {
  const inputPath = 'C:/Users/Kasam/Playground/sb3_compressor/test.sb3';
  const input = fs.readFileSync(inputPath);
  const zip = await JSZip.loadAsync(input);
  const projectJson = await zip.file('project.json').async('string');
  const project = JSON.parse(projectJson);

  console.log('Scanning for menu shadow blocks...\n');

  const menuOpcodes = new Set([
    'looks_costume',
    'looks_backdrops',
    'motion_goto_menu',
    'motion_pointtowards_menu',
    'motion_gotoxy',
    'sound_sounds_menu',
    'sensing_touchingobjectmenu',
    'sensing_distancetomenu',
    'sensing_touchingcolor',
    'control_create_clone_of',
    'operator_join',
    'pen_menu',
    'extension_menu'
  ]);

  let totalMenuShadows = 0;
  let menuShadowByOpcode = {};

  for (const tgt of project.targets) {
    if (!tgt.blocks) continue;
    for (const [bid, blk] of Object.entries(tgt.blocks)) {
      if (!blk || typeof blk !== 'object') continue;
      
      // Check if this is a shadow block that could be a menu
      if (blk.shadow === true && blk.opcode && menuOpcodes.has(blk.opcode)) {
        totalMenuShadows++;
        if (!menuShadowByOpcode[blk.opcode]) menuShadowByOpcode[blk.opcode] = 0;
        menuShadowByOpcode[blk.opcode]++;
      }
    }
  }

  console.log(`Total menu shadow blocks: ${totalMenuShadows}`);
  console.log('\nBy opcode:');
  for (const [opcode, count] of Object.entries(menuShadowByOpcode)) {
    console.log(`  ${opcode}: ${count}`);
  }

  // Sample conversion: show a menu shadow block
  console.log('\nSample menu shadow block:');
  for (const tgt of project.targets) {
    if (!tgt.blocks) continue;
    for (const [bid, blk] of Object.entries(tgt.blocks)) {
      if (blk && blk.shadow === true && blk.opcode === 'looks_costume') {
        console.log(JSON.stringify(blk, null, 2));
        console.log('\nWould convert to: [1, [10, "' + (blk.fields?.COSTUME?.[0] || 'unknown') + '"]]');
        break;
      }
    }
    break;
  }
}

testMenuShadowToText().catch(console.error);
