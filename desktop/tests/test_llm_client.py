from src.llm.client import LLMClient


def test_temperature_adjustment_omits_unsupported_parameter():
    err_text = (
        '{"error":{"message":"The parameter \'temperature\' is not supported by this model route. '
        'Remove the field or choose a different model.","type":"invalid_request_error",'
        '"param":"temperature","code":"unsupported_parameter"}}'
    )

    adjustment = LLMClient._temperature_adjustment_from_error(err_text)

    assert adjustment == {"action": "omit"}


def test_temperature_adjustment_uses_fixed_supported_value():
    err_text = (
        '{"error":{"message":"The value 0.2 for \'temperature\' is not supported by this model route. '
        'Supported values are between 1.0 and 1.0.","type":"invalid_request_error",'
        '"param":"temperature","code":"invalid_parameter"}}'
    )

    adjustment = LLMClient._temperature_adjustment_from_error(err_text)

    assert adjustment == {"action": "set", "value": 1.0}
