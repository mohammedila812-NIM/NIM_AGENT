"""
Skills Engine for NIM_AGENT.
Provides code-free modular agent capabilities defined via SKILL.md documents with optional bundled automation scripts.
"""

import os
import re
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.security.guard import ActionRiskLevel
from src.tools.base import BaseTool, ToolContext, ToolResult
from src.config import APP_DIR

logger = logging.getLogger(__name__)

SKILLS_SYSTEM_DIR = Path(__file__).resolve().parent.parent.parent / "skills"
SKILLS_USER_DIR = APP_DIR / "skills"


@dataclass
class SkillDefinition:
    name: str
    description: str
    triggers: List[str] = field(default_factory=list)
    instructions: str = ""
    file_path: Optional[Path] = None
    scripts: Dict[str, Path] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "triggers": self.triggers,
            "scripts": list(self.scripts.keys()),
            "path": str(self.file_path) if self.file_path else None
        }


class SkillManager:
    """
    Manages loading, auto-matching, and execution of modular SKILL.md skills.
    """

    def __init__(self, search_paths: Optional[List[Path]] = None):
        self.search_paths = search_paths or [SKILLS_SYSTEM_DIR, SKILLS_USER_DIR]
        self._skills: Dict[str, SkillDefinition] = {}
        self.reload_skills()

    def reload_skills(self) -> None:
        """Scans all search paths for skill directories containing SKILL.md."""
        self._skills.clear()
        for base_path in self.search_paths:
            if not base_path.exists():
                try:
                    base_path.mkdir(parents=True, exist_ok=True)
                except Exception:
                    continue

            for item in base_path.iterdir():
                skill_file = item / "SKILL.md" if item.is_dir() else (item if item.name.endswith(".md") else None)
                if skill_file and skill_file.exists():
                    skill = self._parse_skill_file(skill_file)
                    if skill:
                        self._skills[skill.name.lower()] = skill
                        logger.info("Loaded skill: %s from %s", skill.name, skill_file)

    def _parse_skill_file(self, file_path: Path) -> Optional[SkillDefinition]:
        """Parses a SKILL.md file with optional YAML-like frontmatter."""
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error("Failed to read skill file %s: %s", file_path, e)
            return None

        name = file_path.parent.name if file_path.name == "SKILL.md" else file_path.stem
        description = "User-defined skill"
        triggers = []
        instructions = content

        # Check for frontmatter: --- ... ---
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                frontmatter = parts[1]
                instructions = parts[2].strip()

                for line in frontmatter.strip().splitlines():
                    line = line.strip()
                    if line.startswith("name:"):
                        name = line.split(":", 1)[1].strip().strip('"\'')
                    elif line.startswith("description:"):
                        description = line.split(":", 1)[1].strip().strip('"\'')
                    elif line.startswith("triggers:"):
                        raw_trig = line.split(":", 1)[1].strip()
                        m = re.findall(r'["\']([^"\']+)["\']', raw_trig)
                        if m:
                            triggers = [t.lower().strip() for t in m]
                        else:
                            triggers = [t.lower().strip() for t in raw_trig.strip("[]").split(",") if t.strip()]

        # Collect any scripts in scripts/ folder
        scripts_dict: Dict[str, Path] = {}
        scripts_dir = file_path.parent / "scripts"
        if scripts_dir.exists() and scripts_dir.is_dir():
            for s in scripts_dir.iterdir():
                if s.is_file() and s.suffix in [".py", ".ps1", ".bat", ".sh"]:
                    scripts_dict[s.name] = s

        return SkillDefinition(
            name=name,
            description=description,
            triggers=triggers,
            instructions=instructions,
            file_path=file_path,
            scripts=scripts_dict
        )

    def get_skill(self, name: str) -> Optional[SkillDefinition]:
        return self._skills.get(name.lower().strip())

    def list_skills(self) -> List[Dict[str, Any]]:
        return [s.to_dict() for s in self._skills.values()]

    def match_skills(self, query: str) -> List[SkillDefinition]:
        """Auto-detects skills whose triggers or name match the user's query."""
        q = query.lower()
        matched: List[SkillDefinition] = []
        for skill in self._skills.values():
            if skill.name.lower() in q:
                matched.append(skill)
                continue
            for trig in skill.triggers:
                if trig in q:
                    matched.append(skill)
                    break
        return matched

    def create_skill(
        self,
        name: str,
        description: str,
        triggers: List[str],
        instructions: str
    ) -> bool:
        """Saves a new skill into user skills directory."""
        clean_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', name.strip().lower())
        target_dir = SKILLS_USER_DIR / clean_name
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / "SKILL.md"

        frontmatter = (
            f"---\n"
            f"name: {clean_name}\n"
            f"description: \"{description}\"\n"
            f"triggers: {triggers}\n"
            f"---\n\n"
        )
        try:
            target_file.write_text(frontmatter + instructions, encoding="utf-8")
            self.reload_skills()
            return True
        except Exception as e:
            logger.error("Failed to create skill %s: %s", name, e)
            return False


_GLOBAL_SKILL_MANAGER: Optional[SkillManager] = None

def get_skill_manager() -> SkillManager:
    global _GLOBAL_SKILL_MANAGER
    if _GLOBAL_SKILL_MANAGER is None:
        _GLOBAL_SKILL_MANAGER = SkillManager()
    return _GLOBAL_SKILL_MANAGER


class ListSkillsTool(BaseTool):
    name = "list_skills"
    description = "List all available modular skills, their descriptions, and trigger keywords."
    parameters = {
        "type": "object",
        "properties": {}
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "skills"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_skill_manager()
        skills = mgr.list_skills()
        return ToolResult(
            success=True,
            data={"count": len(skills), "skills": skills}
        )


class ReadSkillTool(BaseTool):
    name = "read_skill"
    description = "Read the detailed instructions and workflow of a specific skill."
    parameters = {
        "type": "object",
        "properties": {
            "skill_name": {"type": "string", "description": "The unique name of the skill to read"}
        },
        "required": ["skill_name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "skills"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        s_name = args.get("skill_name", "")
        mgr = get_skill_manager()
        skill = mgr.get_skill(s_name)
        if not skill:
            return ToolResult(success=False, error=f"Skill '{s_name}' not found. Use list_skills to see available skills.")

        return ToolResult(
            success=True,
            data={
                "name": skill.name,
                "description": skill.description,
                "instructions": skill.instructions,
                "scripts": list(skill.scripts.keys())
            }
        )


class RunSkillScriptTool(BaseTool):
    name = "run_skill_script"
    description = "Executes an automation script bundled inside a skill."
    parameters = {
        "type": "object",
        "properties": {
            "skill_name": {"type": "string", "description": "The skill containing the script"},
            "script_name": {"type": "string", "description": "The script filename (e.g. format_table.py)"},
            "script_args": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Arguments to pass to the script"
            }
        },
        "required": ["skill_name", "script_name"]
    }
    risk_level = ActionRiskLevel.MODERATE
    origin = "skills"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        s_name = args.get("skill_name", "")
        sc_name = args.get("script_name", "")
        sc_args = args.get("script_args", [])

        mgr = get_skill_manager()
        skill = mgr.get_skill(s_name)
        if not skill:
            return ToolResult(success=False, error=f"Skill '{s_name}' not found.")

        if sc_name not in skill.scripts:
            return ToolResult(success=False, error=f"Script '{sc_name}' not found in skill '{s_name}'. Available: {list(skill.scripts.keys())}")

        script_path = skill.scripts[sc_name]
        cmd = []
        if script_path.suffix == ".py":
            cmd = ["python", str(script_path)] + sc_args
        elif script_path.suffix == ".ps1":
            cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script_path)] + sc_args
        else:
            cmd = [str(script_path)] + sc_args

        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            )
            return ToolResult(
                success=res.returncode == 0,
                data={
                    "stdout": res.stdout.strip(),
                    "stderr": res.stderr.strip(),
                    "exit_code": res.returncode
                },
                error=res.stderr.strip() if res.returncode != 0 else None
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to execute skill script: {e}")
