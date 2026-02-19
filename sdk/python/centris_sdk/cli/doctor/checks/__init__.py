"""
Centris CLI - Doctor Health Checks

Individual health check modules following the note_* pattern.
Each check function follows this signature:
    note_*_health(result: DoctorResult, prompter: DoctorPrompter, options: DoctorOptions) -> None

The function adds check results to the DoctorResult object.
"""

from centris_sdk.cli.doctor.checks.config import note_config_health
from centris_sdk.cli.doctor.checks.environment import note_environment_health
from centris_sdk.cli.doctor.checks.dependencies import note_dependencies_health
from centris_sdk.cli.doctor.checks.connectors import note_connectors_health
from centris_sdk.cli.doctor.checks.network import note_network_health

__all__ = [
    "note_config_health",
    "note_environment_health",
    "note_dependencies_health",
    "note_connectors_health",
    "note_network_health",
]
