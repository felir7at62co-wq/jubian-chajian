// src/skills-init.js — 内置 Skill 元数据（内容从 skill 目录运行时加载）
// 每个 skill 对应 skills/<id>/ 目录下的 SKILL.md + references/*.md
const BUILTIN_SKILLS = [
  {
    id: 'script-analyzer',
    name: 'script-analyzer',
    description: '从剧本中提取角色、场景、道具信息',
    builtin: true,
    version: '1.0',
    dir: 'skills/script-analyzer',
    refs: []
  },
  {
    id: 'shot-script-creator',
    name: 'shot-script-creator',
    description: '将剧本转为竖屏分镜脚本',
    builtin: true,
    version: '1.0',
    dir: 'skills/shot-script-creator',
    refs: ['advanced-guide.md', 'deep-analysis.md', 'lighting-emotion-map.md', 'seedance-methods.md']
  },
  {
    id: 'reviewing-micro-drama',
    name: 'reviewing-micro-drama',
    description: '微短剧剧本安全审核',
    builtin: true,
    version: '1.0',
    dir: 'skills/reviewing-micro-drama',
    refs: ['platform-guidelines.md']
  },
  {
    id: 'qiuzhi-skill-creator',
    name: 'qiuzhi-skill-creator',
    description: '引导创建自定义 skill',
    builtin: true,
    version: '1.0',
    dir: 'skills/qiuzhi-skill-creator',
    refs: []
  }
];
