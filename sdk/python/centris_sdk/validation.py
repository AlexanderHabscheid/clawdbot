"""
Centris SDK Validation Utilities

Utilities for validating capability parameters.
"""

from typing import Any, Optional, Type, get_type_hints, Union
import json


class ValidationError(Exception):
    """Raised when parameter validation fails."""

    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        value: Any = None,
    ):
        self.message = message
        self.field = field
        self.value = value
        super().__init__(f"{field}: {message}" if field else message)


def validate_params(
    params: dict[str, Any],
    schema: dict[str, Any],
    strict: bool = False,
) -> dict[str, Any]:
    """
    Validate parameters against a JSON Schema.

    Args:
        params: Parameters to validate
        schema: JSON Schema to validate against
        strict: If True, disallow extra properties

    Returns:
        Validated and coerced parameters

    Raises:
        ValidationError: If validation fails
    """
    if not isinstance(params, dict):
        raise ValidationError("Parameters must be an object")

    validated = {}
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    # Check required fields
    for field in required:
        if field not in params or params[field] is None:
            raise ValidationError(f"Required field missing", field=field)

    # Validate each property
    for field, field_schema in properties.items():
        if field in params:
            value = params[field]
            validated[field] = _validate_value(value, field_schema, field)

    # Check for extra properties in strict mode
    if strict:
        extra = set(params.keys()) - set(properties.keys())
        if extra:
            raise ValidationError(
                f"Unknown fields: {', '.join(extra)}",
            )

    # Include extra properties in non-strict mode
    if not strict:
        for key, value in params.items():
            if key not in validated:
                validated[key] = value

    return validated


def _validate_value(
    value: Any,
    schema: dict[str, Any],
    field: str,
) -> Any:
    """Validate a single value against its schema."""
    schema_type = schema.get("type")

    # Handle null/None
    if value is None:
        if schema.get("nullable", False):
            return None
        raise ValidationError("Value cannot be null", field=field, value=value)

    # Type validation
    if schema_type == "string":
        return _validate_string(value, schema, field)
    elif schema_type == "integer":
        return _validate_integer(value, schema, field)
    elif schema_type == "number":
        return _validate_number(value, schema, field)
    elif schema_type == "boolean":
        return _validate_boolean(value, schema, field)
    elif schema_type == "array":
        return _validate_array(value, schema, field)
    elif schema_type == "object":
        return _validate_object(value, schema, field)

    # If no type specified, accept any value
    return value


def _validate_string(value: Any, schema: dict[str, Any], field: str) -> str:
    """Validate a string value."""
    if not isinstance(value, str):
        # Try to coerce
        try:
            value = str(value)
        except Exception:
            raise ValidationError("Expected string", field=field, value=value)

    # Check constraints
    min_length = schema.get("minLength")
    max_length = schema.get("maxLength")
    pattern = schema.get("pattern")
    enum = schema.get("enum")

    if min_length is not None and len(value) < min_length:
        raise ValidationError(
            f"String must be at least {min_length} characters",
            field=field,
            value=value,
        )

    if max_length is not None and len(value) > max_length:
        raise ValidationError(
            f"String must be at most {max_length} characters",
            field=field,
            value=value,
        )

    if enum is not None and value not in enum:
        raise ValidationError(
            f"Value must be one of: {', '.join(enum)}",
            field=field,
            value=value,
        )

    if pattern is not None:
        import re

        if not re.match(pattern, value):
            raise ValidationError(
                f"Value does not match pattern: {pattern}",
                field=field,
                value=value,
            )

    return value


def _validate_integer(value: Any, schema: dict[str, Any], field: str) -> int:
    """Validate an integer value."""
    if isinstance(value, bool):
        raise ValidationError("Expected integer, got boolean", field=field, value=value)

    if not isinstance(value, int):
        # Try to coerce
        try:
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            elif isinstance(value, str):
                value = int(value)
            else:
                raise ValueError()
        except Exception:
            raise ValidationError("Expected integer", field=field, value=value)

    # Check constraints
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")

    if minimum is not None and value < minimum:
        raise ValidationError(
            f"Value must be at least {minimum}",
            field=field,
            value=value,
        )

    if maximum is not None and value > maximum:
        raise ValidationError(
            f"Value must be at most {maximum}",
            field=field,
            value=value,
        )

    return value


def _validate_number(value: Any, schema: dict[str, Any], field: str) -> float:
    """Validate a number value."""
    if isinstance(value, bool):
        raise ValidationError("Expected number, got boolean", field=field, value=value)

    if not isinstance(value, (int, float)):
        # Try to coerce
        try:
            value = float(value)
        except Exception:
            raise ValidationError("Expected number", field=field, value=value)

    # Check constraints
    minimum = schema.get("minimum")
    maximum = schema.get("maximum")

    if minimum is not None and value < minimum:
        raise ValidationError(
            f"Value must be at least {minimum}",
            field=field,
            value=value,
        )

    if maximum is not None and value > maximum:
        raise ValidationError(
            f"Value must be at most {maximum}",
            field=field,
            value=value,
        )

    return float(value)


def _validate_boolean(value: Any, schema: dict[str, Any], field: str) -> bool:
    """Validate a boolean value."""
    if isinstance(value, bool):
        return value

    # Try to coerce
    if isinstance(value, str):
        lower = value.lower()
        if lower in ("true", "1", "yes"):
            return True
        if lower in ("false", "0", "no"):
            return False

    if isinstance(value, int) and value in (0, 1):
        return bool(value)

    raise ValidationError("Expected boolean", field=field, value=value)


def _validate_array(value: Any, schema: dict[str, Any], field: str) -> list[Any]:
    """Validate an array value."""
    if not isinstance(value, list):
        raise ValidationError("Expected array", field=field, value=value)

    # Check constraints
    min_items = schema.get("minItems")
    max_items = schema.get("maxItems")
    items_schema = schema.get("items")

    if min_items is not None and len(value) < min_items:
        raise ValidationError(
            f"Array must have at least {min_items} items",
            field=field,
            value=value,
        )

    if max_items is not None and len(value) > max_items:
        raise ValidationError(
            f"Array must have at most {max_items} items",
            field=field,
            value=value,
        )

    # Validate items
    if items_schema:
        validated = []
        for i, item in enumerate(value):
            validated.append(
                _validate_value(item, items_schema, f"{field}[{i}]")
            )
        return validated

    return value


def _validate_object(value: Any, schema: dict[str, Any], field: str) -> dict[str, Any]:
    """Validate an object value."""
    if not isinstance(value, dict):
        raise ValidationError("Expected object", field=field, value=value)

    # Recursively validate properties if schema has them
    properties = schema.get("properties")
    if properties:
        validated = {}
        required = schema.get("required", [])

        for prop, prop_schema in properties.items():
            if prop in value:
                validated[prop] = _validate_value(
                    value[prop], prop_schema, f"{field}.{prop}"
                )
            elif prop in required:
                raise ValidationError(
                    f"Required field missing",
                    field=f"{field}.{prop}",
                )

        # Include extra properties
        for key, val in value.items():
            if key not in validated:
                validated[key] = val

        return validated

    return value
