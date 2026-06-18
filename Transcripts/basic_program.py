"""Basic Python program for workflow validation."""


def add(a: int, b: int) -> int:
    return a + b


def main() -> None:
    result = add(2, 3)
    print("Workflow test OK")
    print(f"2 + 3 = {result}")


if __name__ == "__main__":
    main()
