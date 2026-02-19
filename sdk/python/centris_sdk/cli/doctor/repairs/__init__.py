"""
Centris CLI - Doctor Repair Functions

Auto-repair modules following the maybe_repair_* pattern.
Each repair function follows this signature:
    maybe_repair_*(result: DoctorResult, prompter: DoctorPrompter, options: DoctorOptions) -> None

The function attempts repairs and records actions in the DoctorResult.
"""

from centris_sdk.cli.doctor.repairs.config import maybe_repair_config
from centris_sdk.cli.doctor.repairs.environment import maybe_repair_env

__all__ = [
    "maybe_repair_config",
    "maybe_repair_env",
]
