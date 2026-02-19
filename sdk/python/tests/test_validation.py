"""
Tests for validation module.

Small, focused tests following Clawdbot patterns.
"""

import pytest

from centris_sdk.validation import validate_params, ValidationError


class TestValidateBasicTypes:
    """Tests for basic type validation."""
    
    def test_validates_string(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
        }
        result = validate_params({"name": "Alice"}, schema)
        assert result["name"] == "Alice"
    
    def test_validates_integer(self):
        schema = {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        }
        result = validate_params({"count": 42}, schema)
        assert result["count"] == 42
    
    def test_validates_number(self):
        schema = {
            "type": "object",
            "properties": {"price": {"type": "number"}},
        }
        result = validate_params({"price": 19.99}, schema)
        assert result["price"] == 19.99
    
    def test_validates_boolean(self):
        schema = {
            "type": "object",
            "properties": {"active": {"type": "boolean"}},
        }
        result = validate_params({"active": True}, schema)
        assert result["active"] is True
    
    def test_validates_array(self):
        schema = {
            "type": "object",
            "properties": {"tags": {"type": "array"}},
        }
        result = validate_params({"tags": ["a", "b", "c"]}, schema)
        assert result["tags"] == ["a", "b", "c"]
    
    def test_validates_object(self):
        schema = {
            "type": "object",
            "properties": {"metadata": {"type": "object"}},
        }
        result = validate_params({"metadata": {"key": "value"}}, schema)
        assert result["metadata"] == {"key": "value"}


class TestRequiredFields:
    """Tests for required field validation."""
    
    def test_passes_when_required_present(self):
        schema = {
            "type": "object",
            "properties": {"email": {"type": "string"}},
            "required": ["email"],
        }
        result = validate_params({"email": "test@example.com"}, schema)
        assert "email" in result
    
    def test_raises_when_required_missing(self):
        schema = {
            "type": "object",
            "properties": {"email": {"type": "string"}},
            "required": ["email"],
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_params({}, schema)
        
        assert exc_info.value.field == "email"
    
    def test_raises_when_required_is_null(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        with pytest.raises(ValidationError):
            validate_params({"name": None}, schema)


class TestTypeCoercion:
    """Tests for automatic type coercion."""
    
    def test_coerces_string_from_int(self):
        schema = {
            "type": "object",
            "properties": {"value": {"type": "string"}},
        }
        result = validate_params({"value": 123}, schema)
        assert result["value"] == "123"
    
    def test_coerces_integer_from_string(self):
        schema = {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        }
        result = validate_params({"count": "42"}, schema)
        assert result["count"] == 42
    
    def test_coerces_integer_from_float(self):
        schema = {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        }
        result = validate_params({"count": 42.0}, schema)
        assert result["count"] == 42
    
    def test_coerces_number_from_string(self):
        schema = {
            "type": "object",
            "properties": {"price": {"type": "number"}},
        }
        result = validate_params({"price": "19.99"}, schema)
        assert result["price"] == 19.99
    
    def test_coerces_boolean_from_string_true(self):
        schema = {
            "type": "object",
            "properties": {"active": {"type": "boolean"}},
        }
        for truthy in ["true", "True", "1", "yes"]:
            result = validate_params({"active": truthy}, schema)
            assert result["active"] is True
    
    def test_coerces_boolean_from_string_false(self):
        schema = {
            "type": "object",
            "properties": {"active": {"type": "boolean"}},
        }
        for falsy in ["false", "False", "0", "no"]:
            result = validate_params({"active": falsy}, schema)
            assert result["active"] is False


class TestStringConstraints:
    """Tests for string constraint validation."""
    
    def test_validates_min_length(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string", "minLength": 3}},
        }
        with pytest.raises(ValidationError):
            validate_params({"name": "ab"}, schema)
    
    def test_validates_max_length(self):
        schema = {
            "type": "object",
            "properties": {"code": {"type": "string", "maxLength": 5}},
        }
        with pytest.raises(ValidationError):
            validate_params({"code": "123456"}, schema)
    
    def test_validates_enum(self):
        schema = {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["active", "inactive"]}},
        }
        # Valid
        result = validate_params({"status": "active"}, schema)
        assert result["status"] == "active"
        
        # Invalid
        with pytest.raises(ValidationError):
            validate_params({"status": "pending"}, schema)
    
    def test_validates_pattern(self):
        schema = {
            "type": "object",
            "properties": {"email": {"type": "string", "pattern": r".*@.*\..*"}},
        }
        # Valid
        result = validate_params({"email": "test@example.com"}, schema)
        assert "test" in result["email"]
        
        # Invalid
        with pytest.raises(ValidationError):
            validate_params({"email": "not-an-email"}, schema)


class TestNumericConstraints:
    """Tests for numeric constraint validation."""
    
    def test_validates_minimum(self):
        schema = {
            "type": "object",
            "properties": {"age": {"type": "integer", "minimum": 0}},
        }
        with pytest.raises(ValidationError):
            validate_params({"age": -1}, schema)
    
    def test_validates_maximum(self):
        schema = {
            "type": "object",
            "properties": {"rating": {"type": "number", "maximum": 5.0}},
        }
        with pytest.raises(ValidationError):
            validate_params({"rating": 6.0}, schema)
    
    def test_rejects_boolean_as_integer(self):
        schema = {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        }
        with pytest.raises(ValidationError):
            validate_params({"count": True}, schema)


class TestArrayConstraints:
    """Tests for array constraint validation."""
    
    def test_validates_min_items(self):
        schema = {
            "type": "object",
            "properties": {"tags": {"type": "array", "minItems": 2}},
        }
        with pytest.raises(ValidationError):
            validate_params({"tags": ["single"]}, schema)
    
    def test_validates_max_items(self):
        schema = {
            "type": "object",
            "properties": {"tags": {"type": "array", "maxItems": 3}},
        }
        with pytest.raises(ValidationError):
            validate_params({"tags": [1, 2, 3, 4]}, schema)
    
    def test_validates_items_schema(self):
        schema = {
            "type": "object",
            "properties": {
                "numbers": {
                    "type": "array",
                    "items": {"type": "integer"},
                }
            },
        }
        result = validate_params({"numbers": [1, 2, "3"]}, schema)
        assert result["numbers"] == [1, 2, 3]  # String "3" coerced to int


class TestNestedObjects:
    """Tests for nested object validation."""
    
    def test_validates_nested_properties(self):
        schema = {
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "age": {"type": "integer"},
                    },
                    "required": ["name"],
                }
            },
        }
        result = validate_params({"user": {"name": "Alice", "age": 30}}, schema)
        assert result["user"]["name"] == "Alice"
    
    def test_validates_nested_required(self):
        schema = {
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                }
            },
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_params({"user": {}}, schema)
        
        assert "name" in str(exc_info.value)


class TestStrictMode:
    """Tests for strict mode validation."""
    
    def test_allows_extra_properties_by_default(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
        }
        result = validate_params({"name": "Alice", "extra": "value"}, schema)
        assert "extra" in result
    
    def test_rejects_extra_properties_in_strict_mode(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_params({"name": "Alice", "extra": "value"}, schema, strict=True)
        
        assert "extra" in str(exc_info.value)


class TestNullableValues:
    """Tests for nullable value handling."""
    
    def test_allows_null_when_nullable(self):
        schema = {
            "type": "object",
            "properties": {"value": {"type": "string", "nullable": True}},
        }
        result = validate_params({"value": None}, schema)
        assert result["value"] is None
    
    def test_rejects_null_when_not_nullable(self):
        schema = {
            "type": "object",
            "properties": {"value": {"type": "string"}},
        }
        with pytest.raises(ValidationError):
            validate_params({"value": None}, schema)


class TestValidationErrorDetails:
    """Tests for ValidationError details."""
    
    def test_includes_field_name(self):
        schema = {
            "type": "object",
            "properties": {"email": {"type": "string"}},
            "required": ["email"],
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_params({}, schema)
        
        assert exc_info.value.field == "email"
    
    def test_includes_error_message(self):
        schema = {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_params({"count": "not-a-number"}, schema)
        
        assert "Expected integer" in exc_info.value.message
    
    def test_error_string_includes_field(self):
        error = ValidationError("Invalid value", field="email")
        assert "email" in str(error)


class TestEdgeCases:
    """Tests for edge cases."""
    
    def test_rejects_non_dict_params(self):
        schema = {"type": "object", "properties": {}}
        with pytest.raises(ValidationError):
            validate_params("not a dict", schema)
    
    def test_handles_empty_schema(self):
        schema = {"type": "object"}
        result = validate_params({"any": "value"}, schema)
        assert result == {"any": "value"}
    
    def test_handles_empty_params(self):
        schema = {
            "type": "object",
            "properties": {"optional": {"type": "string"}},
        }
        result = validate_params({}, schema)
        assert result == {}
    
    def test_accepts_value_without_type_spec(self):
        schema = {
            "type": "object",
            "properties": {"value": {}},  # No type specified
        }
        result = validate_params({"value": [1, 2, 3]}, schema)
        assert result["value"] == [1, 2, 3]
