import sys
import unittest
from unittest.mock import patch

import agent_orchestrator


class DeterministicPlanInvocationTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
