"""Tests for validation utilities."""

import pytest
from centris_sdk.validation import validate_params, ValidationError


class TestValidateParams:
    """Tests for validate_params function."""

    def test_validates_required_fields(self):
        schema = {
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        with pytest.raises(ValidationError) as exc:
            validate_params({}, schema)
        assert exc.value.field == "name"

    def test_validates_string_type(self):
        schema = {"properties": {"name": {"type": "string"}}}
        result = validate_params({"name": "Alice"}, schema)
        assert result["name"] == "Alice"

    def test_coerces_int_to_string(self):
        schema = {"properties": {"id": {"type": "string"}}}
        result = validate_params({"id": 123}, schema)
        assert result["id"] == "123"

    def test_validates_integer_type(self):
        schema = {"properties": {"count": {"type": "integer"}}}
        result = validate_params({"count": 42}, schema)
        assert result["count"] == 42

    def test_rejects_boolean_as_integer(self):
        schema = {"properties": {"count": {"type": "integer"}}}
        with pytest.raises(ValidationError):
            validate_params({"count": True}, schema)

    def test_validates_min_max_integer(self):
        schema = {"properties": {"age": {"type": "integer", "minimum": 0, "maximum": 120}}}
        result = validate_params({"age": 25}, schema)
        assert result["age"] == 25

        with pytest.raises(ValidationError):
            validate_params({"age": -1}, schema)

    def test_validates_string_enum(self):
        schema = {"properties": {"status": {"type": "string", "enum": ["active", "inactive"]}}}
        result = validate_params({"status": "active"}, schema)
        assert result["status"] == "active"

        with pytest.raises(ValidationError):
            validate_params({"status": "unknown"}, schema)

    def test_validates_array_type(self):
        schema = {"properties": {"tags": {"type": "array", "items": {"type": "string"}}}}
        result = validate_params({"tags": ["a", "b"]}, schema)
        assert result["tags"] == ["a", "b"]

    def test_strict_mode_rejects_extra_fields(self):
        schema = {"properties": {"name": {"type": "string"}}}
        with pytest.raises(ValidationError) as exc:
            validate_params({"name": "Alice", "extra": "field"}, schema, strict=True)
        assert "Unknown fields" in exc.value.message

    def test_non_strict_mode_allows_extra_fields(self):
        schema = {"properties": {"name": {"type": "string"}}}
        result = validate_params({"name": "Alice", "extra": "field"}, schema, strict=False)
        assert result["extra"] == "field"
