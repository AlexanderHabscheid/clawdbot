export async function execute(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return {
    echoed: input,
    artifacts: [
      {
        artifactType: "record.ref",
        schema: "centris/artifact/record-ref@v1",
        producerOperation: "crm.contact.lookup",
        value: {
          system: "demo",
          id: "123",
        },
      },
    ],
  };
}
