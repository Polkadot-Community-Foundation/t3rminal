import { useState, useCallback } from "react";

export type CalculatorOperator = "+" | "-" | "×" | "÷";

const OPERATORS = ["+", "-", "×", "÷"];

/**
 * Calculator hook for arithmetic operations
 * Simple expression-based approach - stores expression string and evaluates it
 */
export function useCalculator() {
  const [expression, setExpression] = useState("");

  // Evaluate the expression and return the result
  const evaluateExpression = useCallback((expr: string): string => {
    if (!expr) return "0";

    // Split expression into tokens (numbers and operators)
    const tokens: string[] = [];
    let currentNumber = "";

    for (const char of expr) {
      if (OPERATORS.includes(char)) {
        if (currentNumber) {
          tokens.push(currentNumber);
          currentNumber = "";
        }
        tokens.push(char);
      } else {
        currentNumber += char;
      }
    }
    if (currentNumber) {
      tokens.push(currentNumber);
    }

    // If expression ends with operator, ignore it for calculation
    if (tokens.length > 0 && OPERATORS.includes(tokens[tokens.length - 1])) {
      tokens.pop();
    }

    if (tokens.length === 0) return "0";
    if (tokens.length === 1) return tokens[0] || "0";

    // Evaluate left to right (no operator precedence for simplicity)
    let result = parseFloat(tokens[0]) || 0;

    for (let i = 1; i < tokens.length; i += 2) {
      const operator = tokens[i];
      const operand = parseFloat(tokens[i + 1]) || 0;

      switch (operator) {
        case "+":
          result += operand;
          break;
        case "-":
          result -= operand;
          break;
        case "×":
          result *= operand;
          break;
        case "÷":
          result = operand !== 0 ? result / operand : 0;
          break;
      }
    }

    // Round to avoid floating point issues
    return parseFloat(result.toFixed(10)).toString();
  }, []);

  // Get the current number being edited (last number in expression)
  const getCurrentNumber = useCallback((expr: string): string => {
    if (!expr) return "";

    // Find the last operator position
    let lastOpIndex = -1;
    for (let i = expr.length - 1; i >= 0; i--) {
      if (OPERATORS.includes(expr[i])) {
        lastOpIndex = i;
        break;
      }
    }

    return lastOpIndex === -1 ? expr : expr.slice(lastOpIndex + 1);
  }, []);

  const inputDigit = useCallback((digit: string) => {
    setExpression((prev) => {
      const currentNum = getCurrentNumber(prev);

      // Prevent leading zeros (except for "0.")
      if (currentNum === "0" && digit !== ".") {
        return prev.slice(0, -1) + digit;
      }

      return prev + digit;
    });
  }, [getCurrentNumber]);

  const inputDecimal = useCallback(() => {
    setExpression((prev) => {
      const currentNum = getCurrentNumber(prev);

      // Prevent multiple decimals in same number
      if (currentNum.includes(".")) {
        return prev;
      }

      // Add leading zero if starting number with decimal
      if (currentNum === "") {
        return prev + "0.";
      }

      return prev + ".";
    });
  }, [getCurrentNumber]);

  const inputOperator = useCallback((operator: CalculatorOperator) => {
    setExpression((prev) => {
      // If empty, ignore operator
      if (!prev) return prev;

      // If last char is an operator, replace it
      const lastChar = prev.slice(-1);
      if (OPERATORS.includes(lastChar)) {
        return prev.slice(0, -1) + operator;
      }

      return prev + operator;
    });
  }, []);

  const backspace = useCallback(() => {
    setExpression((prev) => prev.slice(0, -1));
  }, []);

  const clear = useCallback(() => {
    setExpression("");
  }, []);

  const setDirectValue = useCallback((value: string) => {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setExpression(value);
    }
  }, []);

  // Check if expression has any operator
  const hasOperation = OPERATORS.some((op) => expression.includes(op));

  // Get the final numeric result
  const getNumericResult = useCallback((): string => {
    return evaluateExpression(expression);
  }, [expression, evaluateExpression]);

  return {
    displayValue: getCurrentNumber(expression),
    expression,
    hasOperation,
    inputDigit,
    inputDecimal,
    inputOperator,
    calculateResult: () => evaluateExpression(expression),
    backspace,
    clear,
    setDirectValue,
    getNumericResult,
  };
}
