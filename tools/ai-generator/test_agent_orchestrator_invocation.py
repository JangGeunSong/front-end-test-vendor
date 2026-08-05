import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import agent_orchestrator
import render_test_plan


class DeterministicPlanInvocationTest(unittest.TestCase):
    def tearDown(self):
        agent_orchestrator.configure_artifact_paths()

    def test_preserves_builder_validator_and_renderer_arguments(self):
        commands = []

        with (
            patch.object(agent_orchestrator, "build_and_save_menu_map") as build_menu_map,
            patch.object(
                agent_orchestrator,
                "run_subprocess_stage",
                side_effect=lambda stage, command: commands.append((stage, command)),
            ),
        ):
            agent_orchestrator.run_plan_generation_pipeline(
                "https://example.test/",
                use_profile_cache=False,
            )

        build_menu_map.assert_called_once_with(
            "https://example.test/",
            use_profile_cache=False,
            clear_profile_cache=False,
        )
        self.assertEqual(
            commands,
            [
                (
                    "building structured test plan",
                    [
                        sys.executable,
                        str(agent_orchestrator.BUILD_TEST_PLAN_PATH),
                        "--input",
                        str(agent_orchestrator.MENU_MAP_PATH),
                        "--output",
                        str(agent_orchestrator.TEST_PLAN_GENERATED_PATH),
                    ],
                ),
                (
                    "validating structured test plan",
                    [
                        sys.executable,
                        str(agent_orchestrator.VALIDATE_TEST_PLAN_PATH),
                        "--input",
                        str(agent_orchestrator.TEST_PLAN_GENERATED_PATH),
                    ],
                ),
                (
                    "rendering Playwright spec from test plan",
                    [
                        sys.executable,
                        str(agent_orchestrator.RENDER_TEST_PLAN_PATH),
                        "--input",
                        str(agent_orchestrator.TEST_PLAN_GENERATED_PATH),
                        "--output",
                        str(agent_orchestrator.PLAN_RENDER_OUTPUT_PATH),
                    ],
                ),
            ],
        )

    def test_artifact_path_override_is_explicit_and_default_remains_compatible(self):
        agent_orchestrator.configure_artifact_paths()
        self.assertEqual(
            agent_orchestrator.GENERATED_DIR,
            (agent_orchestrator.BASE_DIR / "generated").resolve(),
        )
        self.assertEqual(
            agent_orchestrator.PLAN_RENDER_OUTPUT_PATH,
            (agent_orchestrator.TESTS_GENERATED_DIR / "generated_from_plan.spec.js").resolve(),
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            generated_dir = workspace / "analysis"
            navigation_spec = workspace / "execution" / "specs" / "generated_from_plan.spec.js"
            agent_orchestrator.configure_artifact_paths(generated_dir, navigation_spec)

            self.assertEqual(agent_orchestrator.GENERATED_DIR, generated_dir.resolve())
            self.assertEqual(agent_orchestrator.MENU_MAP_PATH, generated_dir.resolve() / "menu_map.json")
            self.assertEqual(agent_orchestrator.TEST_PLAN_GENERATED_PATH, generated_dir.resolve() / "test_plan.generated.json")
            self.assertEqual(agent_orchestrator.PAGE_PROFILE_CACHE_PATH, generated_dir.resolve() / "page_profile_cache.json")
            self.assertEqual(agent_orchestrator.PLAN_RENDER_OUTPUT_PATH, navigation_spec.resolve())

    def test_navigation_renderer_uses_output_relative_helper_imports(self):
        fixture_path = agent_orchestrator.GENERATED_DIR / "test_plan.example.json"
        agent_orchestrator.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=agent_orchestrator.GENERATED_DIR) as temporary_directory:
            output_path = Path(temporary_directory) / "workspace" / "execution" / "specs" / "generated_from_plan.spec.js"
            render_test_plan.render_file(fixture_path, output_path)
            source = output_path.read_text(encoding="utf-8")
            expected_root = Path(
                __import__("os").path.relpath(render_test_plan.ROOT_DIR / "utils", output_path.parent)
            ).as_posix()
            if not expected_root.startswith("."):
                expected_root = f"./{expected_root}"
            self.assertIn(f"require('{expected_root}/gnb')", source)
            self.assertNotIn(str(render_test_plan.ROOT_DIR), source)


if __name__ == "__main__":
    unittest.main()
