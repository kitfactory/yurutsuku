# 繧・ｋ縺､縺擾ｼ・urutsuku・・窶廣I繧ｨ繝・ぅ繧ｿ縺ｫ霑ｽ蜉隱ｬ譏惹ｸ崎ｦ≫・螳悟・莉墓ｧ・v1.3

> 逶ｮ逧・ｼ壹％縺ｮ1繝輔ぃ繧､繝ｫ縺縺代〒 **螳溯｣・↓蠢・ｦ√↑蜑肴署繝ｻ蛻､譁ｭ繝ｻ邏ｰ驛ｨ繝ｻ譌｢螳壼､繝ｻ繧ｿ繧ｹ繧ｯ**縺梧純縺・∬ｿｽ蜉縺ｮ蜿｣鬆ｭ隱ｬ譏弱ｒ譛蟆丞喧縺吶ｋ縲・ 
> 蟇ｾ雎｡・啀0=Windows-only・・rchestrator+Worker・峨￣1=WSL Worker縲￣2=Linux/macOS縲・
---

## 0. 繝励Ο繝繧ｯ繝医・荳譁・ｮ夂ｾｩ・医さ繝斐・逕ｨ・・**繧・ｋ縺､縺・*縺ｯ縲√％縺溘▽/蝗ｲ轤芽｣上∩縺溘＞縺ｪ窶懊ｆ繧九＞菴懈･ｭ蝣ｴ窶昴〒縲∬､・焚縺ｮ蟇ｾ隧ｱ繧ｻ繝・す繝ｧ繝ｳ繧・ち繧ｹ繧ｯ繧剃ｸｦ縺ｹ縺ｦ騾ｲ繧√∝ｮ御ｺ・豕ｨ諢上ｒ繧ｭ繝｣繝ｩ繧ｯ繧ｿ繝ｼ縺ｮ陦ｨ諠・→髻ｳ縺ｧ莨昴∴縲∵ｬ｡縺ｮ荳謇九∪縺ｧ郢九￡繧句ｸｸ鬧仙梛繧ｪ繝ｼ繧ｱ繧ｹ繝医Ξ繝ｼ繧ｷ繝ｧ繝ｳUI縲・
---

## 1. 繧ｹ繧ｳ繝ｼ繝励→蜆ｪ蜈磯・ｽ・
### 1.1 P0・亥ｿ・茨ｼ啗indows-only縺ｧ螳梧・縺輔○繧具ｼ・- Windows Orchestrator・医ち繧ｹ繧ｯ繝医Ξ繧､蟶ｸ鬧舌ゞI縲・夂衍縲・浹螢ｰ縲∬ｨｭ螳壹∝愛螳壹∝ｾ檎ｶ壼・逅・署譯茨ｼ・- Windows Worker・・onPTY縺ｧ繧ｻ繝・す繝ｧ繝ｳ邯ｭ謖√《tdio NDJSON縺ｧOrchestrator縺ｸ繧ｹ繝医Μ繝ｼ繝溘Φ繧ｰ・・- UI・咾hat繝｢繝ｼ繝会ｼ・繧ｻ繝・す繝ｧ繝ｳ髮・ｸｭ・会ｼ・Run繝｢繝ｼ繝会ｼ医ち繧､繝ｫ謨ｴ蛻暦ｼ・- Judge・唏euristic・亥ｿ・茨ｼ会ｼ・LLM Judge・医が繝励す繝ｧ繝ｳ・・- npm驟榊ｸ・ｼ・indows蜷代￠・会ｼ啻npm i -g @kitfactory/nagomi` 縺ｧ蟆主・縲～nagomi`縺ｧ襍ｷ蜍・
### 1.2 P1・郁ｿｽ蜉・啗SL Worker・・- Orchestrator縺九ｉ `wsl.exe` 邨檎罰縺ｧ Linux Worker 繧・spawn
- 蜷後§NDJSON繝励Ο繝医さ繝ｫ縺ｧ蜍穂ｽ懶ｼ医ロ繝・ヨ繝ｯ繝ｼ繧ｯ縺ｪ縺暦ｼ・- `nagomi setup --wsl` 縺ｧ蟆主・陬懷勧

### 1.3 P2・亥ｰ・擂・哭inux/macOS蜊倅ｽ難ｼ・- Orchestrator/Worker蜷御ｸOS荳翫〒蜍穂ｽ懶ｼ医ヨ繝ｬ繧､縺ｯOS蟾ｮ逡ｰ險ｱ螳ｹ・・
---

## 2. 繧｢繝ｼ繧ｭ繝・け繝√Ε・・rchestrator / Worker・・
### 2.1 Orchestrator・亥ｴ・芽ｲｬ蜍・- 蟶ｸ鬧撰ｼ医ヨ繝ｬ繧､・峨・繧ｦ繧｣繝ｳ繝峨え逕滓・・・hat/Run/Settings・・- 繧ｻ繝・す繝ｧ繝ｳ邂｡逅・ｼ井ｽ懈・/蛛懈ｭ｢/繝輔か繝ｼ繧ｫ繧ｹ/荳ｦ縺ｳ譖ｿ縺茨ｼ・- Worker邂｡逅・ｼ・0縺ｯ繝ｭ繝ｼ繧ｫ繝ｫ縺ｮ縺ｿ縲￣1縺ｧWSL霑ｽ蜉・・- UI迥ｶ諷具ｼ医く繝｣繝ｩ縲√Ξ繝ｼ繝ｳ縲√ち繧､繝ｫ縲√ヰ繝・ず・・- Judge螳溯｡鯉ｼ域ｨ呎ｺ厄ｼ唹rchestrator蛛ｴ・・- 騾夂衍・・S繝医・繧ｹ繝茨ｼ会ｼ・髻ｳ螢ｰ・医ヵ繧｡繧､繝ｫ/TTS・・- 蠕檎ｶ壼・逅・ｼ域署譯医・陦ｨ遉ｺ縲∝ｮ溯｡後・繧ｿ繝ｳ縲￣1縺ｧ閾ｪ蜍募ｮ溯｡鯉ｼ・- 險ｭ螳壽ｰｸ邯壼喧・・SON・・
### 2.2 Worker・域焔・芽ｲｬ蜍・- PTY/ConPTY縺ｧ繝励Ο繧ｻ繧ｹ繧定ｵｷ蜍輔＠蜈･蜃ｺ蜉帙ｒ邯ｭ謖・- 蜃ｺ蜉帙ｒchunk蛹悶＠縺ｦOrchestrator縺ｸ騾∽ｿ｡
- resize蟇ｾ蠢・- stop/cleanup・亥ｭ舌・繝ｭ繧ｻ繧ｹ繧堤｢ｺ螳溘↓邨ゆｺ・ｼ・- **蛻､螳壹・蜴溷援縺励↑縺・*・医◆縺縺用hase謗ｨ螳壹・騾√▲縺ｦ繧医＞・・
### 2.3 騾壻ｿ｡譁ｹ驥晢ｼ・0/P1・・- Orchestrator縺係orker繧痴pawn縺励・*stdin/stdout縺ｧNDJSON**・・陦・JSON・峨ｒ騾∝女菫｡
- 逅・罰・啗indows/WSL縺ｧ遒ｺ螳溘：irewall/port蝠城｡悟屓驕ｿ縲∝ｮ溯｣・ｰ｡邏

---

## 3. ADR・郁ｨｭ險亥愛譁ｭ繝ｭ繧ｰ・哂I縺瑚ｿｷ繧上↑縺・◆繧√・逅・罰・・
### ADR-001・啜auri謗｡逕ｨ・・lectron荳肴治逕ｨ・・- **謗｡逕ｨ**・啜auri・・I縺ｯTS縲√ロ繧､繝・ぅ繝悶・Rust・・- 逅・罰・夊ｵｷ蜍輔′騾溘￥繝｡繝｢繝ｪ縺悟ｰ上＆縺・ｼ上ヨ繝ｬ繧､蟶ｸ鬧舌′迴ｾ螳溽噪・城・蟶・ヰ繧､繝翫Μ蛹悶＠繧・☆縺・- 莉｣譖ｿ・哘lectron・亥唆荳具ｼ壼ｸｸ鬧先凾縺ｮ繝｡繝｢繝ｪ蠅励→驟榊ｸ・し繧､繧ｺ縺悟､ｧ縺阪＞・・
### ADR-002・啗orker繧坦ust縺ｫ縺吶ｋ
- **謗｡逕ｨ**・啗orker縺ｯRust・・TY/ConPTY/繝励Ο繧ｻ繧ｹ邂｡逅・ｼ・- 逅・罰・啗indows縺ｮPTY縺ｯ關ｽ縺ｨ縺礼ｩｴ縺悟､壹＞縲る聞譎る俣蟶ｸ鬧舌〒蝣・欧諤ｧ繧貞━蜈・- 莉｣譖ｿ・嗜ode-pty・亥唆荳具ｼ夐°逕ｨ縺ｧ繝上・繧翫ｄ縺吶＞鬆伜沺縺悟｢励∴繧具ｼ・
### ADR-003・哢DJSON over stdio
- **謗｡逕ｨ**・哢DJSON・・tdio・・- 逅・罰・壼腰邏斐〒繝・ヰ繝・げ螳ｹ譏薙仝SL繧ょ酔蠖｢縲∫鮪騾壹′螳牙ｮ・- 莉｣譖ｿ・啗ebSocket/HTTP・亥唆荳具ｼ壼・譛溘↓port/讓ｩ髯・Firewall繧定ｸ上∩繧・☆縺・ｼ・
### ADR-004・壼愛螳夲ｼ・udge・峨・Orchestrator蛛ｴ繧呈ｨ呎ｺ・- **謗｡逕ｨ**・哽udge縺ｯOrchestrator
- 逅・罰・啅I貍泌・縺ｨ荳菴灘喧縲仝orker蟾ｮ縺玲崛縺医↓蠑ｷ縺・´LM蛻ｩ逕ｨ繝昴Μ繧ｷ繝ｼ繧る寔荳ｭ邂｡逅・- 莉｣譖ｿ・啗orker蛛ｴ蛻､螳夲ｼ亥唆荳具ｼ壼・謨｣縺励※莉墓ｧ倥′蜑ｲ繧後ｋ・・
---

## 4. UI/UX 莉墓ｧ假ｼ域焚蛟､譌｢螳壼､縺､縺搾ｼ・
### 4.1 蜈ｱ騾夲ｼ夂畑隱橸ｼ・I陦ｨ遉ｺ蜷搾ｼ・- 繧ｻ繝・す繝ｧ繝ｳ・・*縺､縺上ｊ**
- Run繝｢繝ｼ繝会ｼ・*縺ｿ繧薙↑縺ｮ讒伜ｭ・*
- Chat繝｢繝ｼ繝会ｼ・*縺翫・縺ｪ縺・*
- Worker・・*謇・*
- Orchestrator・・*蝣ｴ**・亥ｮ溯｣・錐縺ｯOrchestrator・・
### 4.2 Chat繝｢繝ｼ繝会ｼ医♀縺ｯ縺ｪ縺暦ｼ・- 蟾ｦ・壼ｯｾ隧ｱ繝ｬ繝ｼ繝ｳ・医さ繝ｳ繧ｽ繝ｼ繝ｫ鬚ｨ・・- 蜿ｳ荳具ｼ壹く繝｣繝ｩ繧ｯ繧ｿ繝ｼ・郁｡ｨ諠・ｼ句聖縺榊・縺嶺ｻｻ諢擾ｼ・- 蜈･蜉帶ｬ・ｼ壻ｸ矩Κ蝗ｺ螳壹・nter騾∽ｿ｡縲ヾhift+Enter謾ｹ陦鯉ｼ域里螳夲ｼ・- 繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ・・  - 譛ｫ蟆ｾ霑ｽ蠕徹N縺梧里螳・  - 繝ｦ繝ｼ繧ｶ繝ｼ縺御ｸ翫∈繧ｹ繧ｯ繝ｭ繝ｼ繝ｫ縺励◆繧芽ｿｽ蠕徹FF
  - 縲梧忰蟆ｾ縺ｸ縲阪・繧ｿ繝ｳ縺ｧ霑ｽ蠕徹N縺ｫ謌ｻ縺・- 陦ｨ遉ｺ菫晄戟・壹Ξ繝ｼ繝ｳ縺ｯ **譛螟ｧ 20,000 陦・*・郁ｶ・℃縺ｯ蜈磯ｭ縺九ｉ遐ｴ譽・ｼ・- 譁・ｭ怜・逅・ｼ哂NSI/VT100繧ｨ繧ｹ繧ｱ繝ｼ繝励ｒ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ・・term.js遲会ｼ・
### 4.3 Run繝｢繝ｼ繝会ｼ医∩繧薙↑縺ｮ讒伜ｭ撰ｼ・- 繧ｿ繧､繝ｫ謨ｴ蛻暦ｼ壽里螳・2蛻暦ｼ医え繧｣繝ｳ繝峨え蟷・↓繧医ｊ閾ｪ蜍輔〒2縲・蛻暦ｼ・- 繧ｯ繝ｪ繝・け・壹ヵ繧ｩ繝ｼ繧ｫ繧ｹ諡｡螟ｧ・亥咲紫 1.8x・・- 繝繝悶Ν繧ｯ繝ｪ繝・け・壼・謨ｴ蛻暦ｼ医ヵ繧ｩ繝ｼ繧ｫ繧ｹ隗｣髯､・・- 繧ｿ繧､繝ｫ繝倥ャ繝・・  - 縺､縺上ｊ蜷搾ｼ医そ繝・す繝ｧ繝ｳ蜷搾ｼ・  - 迥ｶ諷九ヰ繝・ず
  - 邨碁℃譎る俣・・m:ss・・- 蜿ｳ荳翫↓縲梧眠縺励＞縺､縺上ｊ縲搾ｼ九瑚ｨｭ螳壹・
### 4.4 繧ｭ繝｣繝ｩ繧ｯ繧ｿ繝ｼ貍泌・・亥━蜈磯・ｽ阪→菫晄戟譎る俣・・- 迥ｶ諷具ｼ・hase・牙━蜈磯・ｽ搾ｼ・  1. attention・亥他縺ｳ縺九￠・・  2. error・亥､ｱ謨・逡ｰ蟶ｸ・・  3. success・亥ｮ御ｺ・ｼ・  4. running・井ｽ懈･ｭ荳ｭ・・  5. thinking・郁・∴荳ｭ・・  6. listening・亥・蜉帑ｸｭ・・  7. idle・亥ｾ・ｩ滂ｼ・- success/error/attention 縺ｮ陦ｨ諠・ｿ晄戟・壽里螳・4遘抵ｼ医◎縺ｮ蠕・idle/thinking 縺ｫ謌ｻ縺呻ｼ・- 髻ｳ螢ｰ蜀咲函荳ｭ縺ｯ speaking 繝輔Λ繧ｰ繧堤ｫ九※縺ｦ蜿｣繝代け・・0縺ｯ莉ｻ諢上￣1莉･髯阪〒繧ょ庄・・
---

## 5. 騾夂衍莉墓ｧ假ｼ・S騾夂衍・矩浹螢ｰ・・
### 5.1 OS騾夂衍・医ヨ繝ｼ繧ｹ繝茨ｼ・- 繝医Μ繧ｬ・嗾urn_completed・・uccess/failure/attention・・- 譌｢螳夲ｼ喃ailure/attention縺ｮ縺ｿ騾夂衍ON縲《uccess縺ｯOFF・医≧繧九＆縺募屓驕ｿ・・- 騾夂衍譛ｬ譁・ｼ・  - 繧ｿ繧､繝医Ν・啻繧・ｋ縺､縺擾ｼ嘴縺､縺上ｊ蜷閤`
  - 譛ｬ譁・ｼ哽udge summary・域怙螟ｧ 120譁・ｭ励∬ｶ・℃縺ｯ逵∫払・・
### 5.2 髻ｳ螢ｰ騾夂衍・亥ｿ・茨ｼ・- 繝医Μ繧ｬ・嗾urn_completed・・uccess/failure/attention・・- 譌｢螳夲ｼ喃ailure/attention縺ｮ縺ｿON縲《uccess縺ｯOFF
- 遞ｮ蛻･・嘖ound_file / tts
- 繧ｯ繝ｼ繝ｫ繝繧ｦ繝ｳ・壽里螳・1500ms・亥酔遞ｮ繧､繝吶Φ繝磯｣謇馴亟豁｢・・- 髻ｳ驥擾ｼ・.0縲・.0・域里螳・0.8・・- 繝・せ繝亥・逕溘・繧ｿ繝ｳ・售ettings縺ｫ蠢・・
---

## 6. 繧ｻ繝・す繝ｧ繝ｳ莉墓ｧ假ｼ育ｶ咏ｶ壼燕謠撰ｼ・
### 6.1 縺､縺上ｊ・・ession・峨ョ繝ｼ繧ｿ繝｢繝・Ν
- session_id・・UID v4・・- name・・I陦ｨ遉ｺ蜷阪∵里螳夲ｼ啻縺､縺上ｊ-{遏ｭID}`・・- worker_id・・0縺ｯ `local`・・- cmd・郁ｵｷ蜍輔さ繝槭Φ繝会ｼ・- cwd・井ｻｻ諢擾ｼ・- env・井ｻｻ諢擾ｼ・- character_id・医く繝｣繝ｩ蜑ｲ蠖難ｼ・- judge_profile・亥愛螳壹・繝ｭ繝輔ぃ繧､繝ｫ蜷搾ｼ・- created_at / started_at / last_output_at
- stats・・  - exit_status・域怙蠕後・turn_completed縺ｮstatus・・  - duration_ms
  - last_summary

### 6.2 繧ｿ繝ｼ繝ｳ・・urn・画ｦょｿｵ
- 窶懊ち繝ｼ繝ｳ窶晢ｼ昴Θ繝ｼ繧ｶ繝ｼ縺碁∽ｿ｡縺励◆蜈･蜉帙↓蟇ｾ縺吶ｋ荳騾｣縺ｮ蜿榊ｿ懊・縺ｾ縺ｨ縺ｾ繧・- P0縺ｧ縺ｯ蜴ｳ蟇・↑蠅・阜縺ｯ荳崎ｦ√ゆｻ･荳九〒蛻､螳夲ｼ・  - 蜈･蜉幃∽ｿ｡ 竊・thinking 縺ｸ
  - 蜃ｺ蜉帙′荳螳壽凾髢捺ｭ｢縺ｾ繧具ｼ域ｲ磯ｻ呻ｼ俄・ turn_completed蛟呵｣・  - exit繧ｳ繝ｼ繝峨′遒ｺ螳・竊・turn_completed遒ｺ螳・- 豐磯ｻ吶ち繧､繝繧｢繧ｦ繝茨ｼ壽里螳・3.5遘抵ｼ医Θ繝ｼ繧ｶ繝ｼ縺瑚ｪｿ謨ｴ蜿ｯ閭ｽ・・
---

## 7. Judge莉墓ｧ假ｼ亥ｮ溯｣・・豎ｺ繧∵遠縺｡・・
### 7.1 Heuristic Judge・・0蠢・茨ｼ・蜈･蜉幢ｼ・- exit_code・医ｂ縺怜・縺九ｌ縺ｰ・・- stderr譛臥┌
- 譛ｫ蟆ｾ繝ｭ繧ｰ・・ail_lines・壽里螳・80陦鯉ｼ・- 豁｣隕剰｡ｨ迴ｾ繝偵ャ繝茨ｼ井ｸ玖ｨ假ｼ・- 豐磯ｻ呎凾髢・
蛻､螳壹Ν繝ｼ繝ｫ・域里螳夲ｼ会ｼ・- exit_code == 0 竊・success
- exit_code != 0 竊・failure
- exit_code譛ｪ遏･縺ｧ莉･荳九↓隧ｲ蠖・竊・attention
  - `(?i)error|failed|exception|panic|traceback|permission denied|cannot|timeout|timed out|segmentation fault`
- 縺昴ｌ莉･螟悶〒豐磯ｻ吶ち繧､繝繧｢繧ｦ繝亥芦驕・竊・unknown・医◆縺縺誘I荳翫・thinking竊段dle縺ｫ謌ｻ縺呻ｼ・
summary逕滓・・域里螳夲ｼ会ｼ・- failure/attention 縺ｮ蝣ｴ蜷茨ｼ壽忰蟆ｾ繝ｭ繧ｰ縺九ｉ 窶懈怙繧ゅ◎繧後▲縺ｽ縺・縲・陦娯・繧呈歓蜃ｺ・域ｭ｣隕剰｡ｨ迴ｾ繝偵ャ繝郁｡後ｒ蜆ｪ蜈茨ｼ・- success 縺ｮ蝣ｴ蜷茨ｼ啻螳御ｺ・＠縺ｾ縺励◆`・医∪縺溘・遏ｭ縺・崋螳壽枚・・
### 7.2 LLM Judge・・0繧ｪ繝励す繝ｧ繝ｳ縲￣1莉･髯榊ｼｷ蛹厄ｼ・- 逶ｮ逧・ｼ唏euristic縺ｧ荳榊香蛻・↑縺ｨ縺阪・隕∫ｴ・∵ｬ｡繧｢繧ｯ繧ｷ繝ｧ繝ｳ謠先｡・- 蜻ｼ縺ｳ蜃ｺ縺玲擅莉ｶ・域里螳夲ｼ会ｼ・  - failure/attention 縺ｮ縺ｨ縺阪・縺ｿ
  - unknown縺ｧ繝ｦ繝ｼ繧ｶ繝ｼ縺梧・遉ｺ逧・↓縲悟愛螳壹＠縺ｦ縲阪＠縺溘→縺・- 蜈･蜉帙↓蜷ｫ繧√ｋ縺ｮ縺ｯ **繝槭せ繧ｯ貂医∩** 縺ｮ譛ｫ蟆ｾ繝ｭ繧ｰ・域里螳・120陦鯉ｼ会ｼ狗腸蠅・ュ蝣ｱ・・md/cwd/OS・・- 蜃ｺ蜉帙・ 7.3 縺ｮ蜈ｱ騾壹ヵ繧ｩ繝ｼ繝槭ャ繝医↓驕ｩ蜷医＆縺帙ｋ・・SON縺ｧ・・- 螟ｱ謨玲凾縺ｯHeuristic邨先棡縺ｫ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ

### 7.3 Judge 蜈ｱ騾壼・蜉幢ｼ亥崋螳夲ｼ・```json
{
  "state": "success | failure | attention | running | thinking | unknown",
  "confidence": 0.0,
  "summary": "遏ｭ縺・ｦ∫ｴ・ｼ域怙螟ｧ120譁・ｭ玲耳螂ｨ・・,
  "evidence": ["譬ｹ諡繝ｭ繧ｰ・域怙螟ｧ3陦鯉ｼ・],
  "next_actions": [
    { "title": "谺｡縺ｮ謇・, "command": "窶ｦ", "risk": "low|mid|high" }
  ]
}
```

---

## 8. 繧ｻ繧ｭ繝･繝ｪ繝・ぅ・医Ο繧ｰ繝槭せ繧ｯ隕丞援・哂I縺ｫ霑ｽ蜉隱ｬ譏惹ｸ崎ｦ・ｼ・
### 8.1 繝槭せ繧ｯ蟇ｾ雎｡・域里螳夲ｼ夐∽ｿ｡/菫晏ｭ倥・荳｡譁ｹ縺ｫ驕ｩ逕ｨ・・- `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----` 莉･髯阪・繝悶Ο繝・け
- JWT縺｣縺ｽ縺・ｼ啻[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`
- OpenAI/蜷・ｨｮAPI繧ｭ繝ｼ縺｣縺ｽ縺・ｼ啻(?i)(api[_-]?key|token|secret)\s*[:=]\s*\S+`
- `Authorization: Bearer ...`
- 16譁・ｭ嶺ｻ･荳翫・繝ｩ繝ｳ繝繝闍ｱ謨ｰ蛻暦ｼ郁ｪ､讀懃衍繧帝∩縺代ｋ縺溘ａ蜻ｨ霎ｺ隱槭′縺ゅｋ蝣ｴ蜷医・縺ｿ・・
### 8.2 繝槭せ繧ｯ譁ｹ豕・- 讀懷・縺励◆蛟､縺ｯ `***REDACTED***` 縺ｫ鄂ｮ謠・- 鄂ｮ謠帛ｾ後ｂ陦梧ｧ矩縺ｯ邯ｭ謖・ｼ医ョ繝舌ャ繧ｰ縺ｮ縺溘ａ・・
### 8.3 螟夜Κ騾∽ｿ｡繝昴Μ繧ｷ繝ｼ
- LLM Judge繧剃ｽｿ縺・ｴ蜷医・縺ｿ螟夜Κ騾∽ｿ｡・・0縺ｧ縺ｯOFF縺梧里螳夲ｼ・- Settings縺ｧ譏守､ｺON・亥酔諢擾ｼ峨＠縺ｪ縺・剞繧企√ｉ縺ｪ縺・
---

## 9. Orchestrator 竍・Worker NDJSON 繝励Ο繝医さ繝ｫ・亥宍蟇・ｻ墓ｧ假ｼ・
### 9.1 蠖｢蠑・- UTF-8
- 1陦・JSON・域忰蟆ｾ `\n`・・- `type` 縺ｯ蠢・・- 譛ｪ遏･縺ｮ `type` 縺ｯ辟｡隕厄ｼ亥ｰ・擂諡｡蠑ｵ・・
### 9.2 Orchestrator 竊・Worker
#### start_session
```json
{
  "type": "start_session",
  "session_id": "uuid",
  "cmd": "string",
  "cwd": "string|null",
  "env": {"KEY":"VALUE"},
  "cols": 120,
  "rows": 30
}
```
#### send_input
```json
{"type":"send_input","session_id":"uuid","text":"string"}
```
#### resize
```json
{"type":"resize","session_id":"uuid","cols":120,"rows":40}
```
#### stop_session
```json
{"type":"stop_session","session_id":"uuid"}
```
#### ping
```json
{"type":"ping"}
```

### 9.3 Worker 竊・Orchestrator
#### output
- chunk縺ｯ **譛螟ｧ 4096 bytes** 逶ｮ螳峨〒蛻・牡
```json
{"type":"output","session_id":"uuid","stream":"stdout","chunk":"...raw..."} 
```
#### phase
```json
{"type":"phase","session_id":"uuid","phase":"thinking","detail":"optional"}
```
#### exit・医・繝ｭ繧ｻ繧ｹ邨ゆｺ・ｼ・```json
{"type":"exit","session_id":"uuid","exit_code":0}
```
#### error
```json
{"type":"error","session_id":"uuid","message":"...","recoverable":true}
```

---

## 10. 繝｢繝弱Ξ繝晄ｧ区・・域ｱｺ繧∵遠縺｡・・
### 10.1 繝・ぅ繝ｬ繧ｯ繝医Μ
```
repo/
  package.json
  pnpm-workspace.yaml            # 謗ｨ螂ｨ・・pm workspaces縺ｧ繧ょ庄・・  Cargo.toml                     # Rust workspace
  apps/
    orchestrator/                # Tauri v2 app
      src/                       # TS UI
      src-tauri/                 # Rust・郁埋縺・ｼ壹ヨ繝ｬ繧､/繧ｦ繧｣繝ｳ繝峨え/險ｭ螳夲ｼ・  crates/
    worker/                      # Rust worker (pty/process, ndjson)
    protocol/                    # Rust protocol types (serde)
  packages/
    cli/                         # nagomi CLI (node)
    protocol/                    # TS protocol types (zod遲峨・莉ｻ諢・
    assets/                      # Character packs
  tooling/
    scripts/                     # release helpers
```

### 10.2 荳ｻ隕√さ繝槭Φ繝会ｼ・I縺後◎縺ｮ縺ｾ縺ｾ螳溯｣・☆繧句燕謠舌・I/F・・- `pnpm dev`・唹rchestrator dev襍ｷ蜍包ｼ・auri・・- `pnpm build`・啗indows release build
- `pnpm lint`・啜S lint
- `pnpm test`・壽怙蟆上・繝励Ο繝医さ繝ｫ繝・せ繝・- `cargo build -p nagomi-worker`・嗹orker build

---

## 11. 蛻晄悄繝輔ぃ繧､繝ｫ・医ユ繝ｳ繝励Ξ・哂I縺後◎縺ｮ縺ｾ縺ｾ逕滓・縺吶ｋ・・
> 豕ｨ・壹％縺薙〒縺ｯ縲檎函謌千黄縺ｮ蠖｢縲阪ｒ譏守､ｺ縺吶ｋ縲ょｮ溘ヵ繧｡繧､繝ｫ蜀・ｮｹ縺ｯAI繧ｨ繝・ぅ繧ｿ縺後％縺ｮ莉墓ｧ倥↓蠕薙▲縺ｦ菴懈・縺吶ｋ縲・
### 11.1 繝ｫ繝ｼ繝・package.json・井ｾ具ｼ嗔npm・・- workspace蛻ｩ逕ｨ
- `dev/build/lint/test` 繧ｹ繧ｯ繝ｪ繝励ヨ
- `nagomi` CLI繝代ャ繧ｱ繝ｼ繧ｸ縺ｸ縺ｮ蜿ら・

### 11.2 Cargo workspace
- members: `crates/worker`, `crates/protocol`, `apps/orchestrator/src-tauri`・亥ｿ・ｦ√↑繧会ｼ・
### 11.3 CLI・・ackages/cli・我ｻ墓ｧ・- `nagomi` 繧ｳ繝槭Φ繝峨ｒ謠蝉ｾ・- `nagomi`・唹rchestrator繧定ｵｷ蜍包ｼ域里蟄倩ｵｷ蜍輔↑繧牙燕髱｢蛹厄ｼ・- `nagomi setup --wsl`・啀1縺ｧWSL worker蟆主・
- `nagomi doctor`・壻ｾ晏ｭ倡｢ｺ隱搾ｼ・ebView2/讓ｩ髯・WSL蟄伜惠・・
---

## 12. 驟榊ｸ・ｼ・pm・我ｻ墓ｧ假ｼ・0・啗indows縺ｮ縺ｿ・・
### 12.1 譁ｹ驥・- npm縺ｫ **莠句燕繝薙Ν繝画ｸ医∩繝舌う繝翫Μ** 繧貞酔譴ｱ/驕ｸ謚槭＠縺ｦ謠蝉ｾ帙☆繧・- CLI縺ｯ迺ｰ蠅・↓蠢懊§縺ｦ Orchestrator/Worker 繝舌う繝翫Μ繧定ｧ｣豎ｺ縺励※襍ｷ蜍・
### 12.2 繝代ャ繧ｱ繝ｼ繧ｸ・域｡茨ｼ・- `@kitfactory/nagomi`・・LI・・- `@kitfactory/nagomi-orchestrator-win32-x64-msvc`
- `@kitfactory/nagomi-worker-win32-x64-msvc`
- ・・1・荏@kitfactory/nagomi-worker-linux-x64-gnu`

---

## 13. 螳溯｣・ち繧ｹ繧ｯ・・EQ-ID・哂I縺瑚ｿｷ繧上↑縺・ｲ貞ｺｦ・・
### REQ-001 繝｢繝弱Ξ繝晏・譛溷喧
- workspace + cargo workspace菴懈・
- 譛蟆上ン繝ｫ繝峨′騾壹ｋ

### REQ-002 Protocol螳夂ｾｩ・・S/Rust蜷悟梛・・- `type` union/enum
- JSON繧ｷ繝ｪ繧｢繝ｩ繧､繧ｺ/繝代・繧ｹ
- 莠呈鋤繝・せ繝茨ｼ・olden・・
### REQ-003 Worker・・ust・・- ConPTY縺ｧ繝励Ο繧ｻ繧ｹ襍ｷ蜍・- stdin縺ｸ縺ｮ蜈･蜉幃∽ｿ｡
- stdout/stderr隱ｭ縺ｿ蜿悶ｊ
- chunk蛹悶＠縺ｦNDJSON output騾∽ｿ｡
- resize蟇ｾ蠢・- stop縺ｧ繧ｯ繝ｪ繝ｼ繝ｳ邨ゆｺ・- exit繧､繝吶Φ繝磯∽ｿ｡

### REQ-004 Orchestrator・・auri・蛾ｪｨ譬ｼ
- 繝医Ξ繧､蟶ｸ鬧・- Run/Chat/Settings繧ｦ繧｣繝ｳ繝峨え逕滓・
- 險ｭ螳壻ｿ晏ｭ假ｼ・SON・・
### REQ-005 Orchestrator 竍・Worker 謗･邯・- spawn worker・・tdio・・- NDJSON send/receive
- 繧ｻ繝・す繝ｧ繝ｳstart/stop

### REQ-006 Chat繝｢繝ｼ繝蔚I
- 繝ｬ繝ｼ繝ｳ陦ｨ遉ｺ・・term.js遲会ｼ・- 蜈･蜉帶ｬ・ｼ・nter騾∽ｿ｡/Shift+Enter・・- 閾ｪ蜍輔せ繧ｯ繝ｭ繝ｼ繝ｫ縺ｨ隗｣髯､
- 繝ｬ繝ｼ繝ｳ譛螟ｧ陦梧焚縺ｮ蛻ｶ髯・
### REQ-007 繧ｭ繝｣繝ｩ繧ｯ繧ｿ繝ｼUI
- 蜿ｳ荳玖｡ｨ遉ｺ・育判蜒擾ｼ・- phase竊定｡ｨ諠・・繝・ヴ繝ｳ繧ｰ・亥━蜈磯・ｽ阪∽ｿ晄戟譎る俣・・- 繧ｻ繝・す繝ｧ繝ｳ縺斐→縺ｮ繧ｭ繝｣繝ｩ蜑ｲ蠖・
### REQ-008 Run繝｢繝ｼ繝蔚I
- 繧ｿ繧､繝ｫ謨ｴ蛻暦ｼ・縲・蛻暦ｼ・- 繧ｯ繝ｪ繝・け縺ｧ繝輔か繝ｼ繧ｫ繧ｹ諡｡螟ｧ・・.8x・・- 繝繝悶Ν繧ｯ繝ｪ繝・け縺ｧ蜀肴紛蛻・- 繝舌ャ繧ｸ/邨碁℃譎る俣

### REQ-009 Heuristic Judge・亥ｿ・茨ｼ・- regex/exit_code/豐磯ｻ吶〒turn_completed逕滓・
- summary逕滓・

### REQ-010 騾夂衍・・S・矩浹螢ｰ・・- 繝医・繧ｹ繝茨ｼ域里螳壹・failure/attention縺ｮ縺ｿ・・- 髻ｳ螢ｰ・医ヵ繧｡繧､繝ｫ縲√け繝ｼ繝ｫ繝繧ｦ繝ｳ縲√ユ繧ｹ繝亥・逕滂ｼ・
### REQ-011 蠕檎ｶ壼・逅・ｼ域署譯茨ｼ・- next_actions繧旦I陦ｨ遉ｺ
- 螳溯｡後・繧ｿ繝ｳ・・0縺ｯ謇句虚・・
### REQ-012 Settings
- 騾夂衍ON/OFF
- 髻ｳ驥上・浹貅舌√ユ繧ｹ繝・- 豐磯ｻ吶ち繧､繝繧｢繧ｦ繝・- LLM Judge ON/OFF・・0譌｢螳唹FF・・- 繧ｭ繝｣繝ｩ蜑ｲ蠖・- 繝ｭ繧ｰ菫晄戟陦梧焚

### REQ-013 P1: WSL Worker
- `wsl.exe -d <distro> -- nagomi-worker --stdio`
- setup繧ｳ繝槭Φ繝・- Orchestrator縺ｧworker驕ｸ謚・
---

## 14. 蜿励￠蜈･繧悟渕貅厄ｼ・0・啗indows-only・・1. Orchestrator縺係indows繝医Ξ繧､蟶ｸ鬧舌〒縺阪ｋ  
2. Chat繝｢繝ｼ繝峨〒縲悟ｷｦ・壹Ξ繝ｼ繝ｳ縲阪悟承荳具ｼ壹く繝｣繝ｩ縲阪′陦ｨ遉ｺ縺輔ｌ繧・ 
3. 邯咏ｶ壹そ繝・す繝ｧ繝ｳ縺ｧ蜈･蜉帚・蜃ｺ蜉帙′豬√ｌ繧・ 
4. phase・・hinking/running/success/error/attention・峨′UI縺ｫ蜿肴丐縺輔ｌ繧・ 
5. failure/attention縺ｧOS騾夂衍・矩浹螢ｰ騾夂衍縺碁ｳｴ繧具ｼ医ユ繧ｹ繝亥・逕溘≠繧奇ｼ・ 
6. Run繝｢繝ｼ繝画紛蛻暦ｼ九け繝ｪ繝・け諡｡螟ｧ・九ム繝悶Ν繧ｯ繝ｪ繝・け蜀肴紛蛻励′蜍輔￥  
7. Heuristic Judge縺ｧturn_completed縺檎匱轣ｫ縺励《ummary縺瑚｡ｨ遉ｺ縺輔ｌ繧・ 
8. next_actions・域署譯茨ｼ峨′陦ｨ遉ｺ縺輔ｌ縲∵焔蜍募ｮ溯｡後〒縺阪ｋ  

---

## 15. 蜿励￠蜈･繧悟渕貅厄ｼ・1・啗SL Worker・・- Orchestrator縺九ｉWSL Worker繧帝∈謚槭＠縲∝酔縺篭I/騾夂衍/陦ｨ諠・〒蜍輔￥  
- stdio NDJSON繝励Ο繝医さ繝ｫ縺悟酔蠖｢縺ｧ騾壹ｋ  

---

## 16. 窶懊ｆ繧九▽縺鞘昴ｉ縺励＆繝√ぉ繝・け・医・繝ｭ繝繧ｯ繝亥愛譁ｭ霆ｸ・・- 謌仙粥騾夂衍縺ｯ髱吶°縺ｧ濶ｯ縺・ｼ医ョ繝輔か繝ｫ繝・FF縺ｧ繧０K・・- 螟ｱ謨・豕ｨ諢上・縲瑚ｲｬ繧√★縺ｫ蜻ｼ縺ｶ縲・- UI縺ｯ逶｣隕悶〒縺ｯ縺ｪ縺鞘懷ｴ縺ｮ遨ｺ豌冷昴ｒ菴懊ｋ・郁ｵ､縺繧峨￠縺ｫ縺励↑縺・ｼ・- 霑ｷ縺｣縺溘ｉ縲梧ｭ｢縺ｾ繧峨↑縺・阪碁が鬲斐＠縺ｪ縺・阪後≠縺ｨ縺ｧ蜿悶ｊ霑斐○繧九・
---

