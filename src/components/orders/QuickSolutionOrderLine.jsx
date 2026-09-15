import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, Package, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  buildQuickSolutionInitialConfiguration,
  quickSolutionConfigurationComplete,
  quoteQuickSolutionStaffItem,
} from "@/lib/quickSolutionStaffCatalog";

function money(value) {
  const number = Number(value || 0);

  return Number.isFinite(number)
    ? `R${number.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`
    : "—";
}

function fieldOptions(field) {
  return Array.isArray(field?.options) ? field.options : [];
}

export default function QuickSolutionOrderLine({
  tenantId,
  catalog,
  line,
  onPatch,
  onRemove,
  allowRemove,
}) {
  const productKey = line?.quick_solution?.product_key || "";

  const product = useMemo(
    () => catalog.find((item) => item.id === productKey) || null,
    [catalog, productKey]
  );

  const configuration =
    line?.quick_solution?.configuration &&
    typeof line.quick_solution.configuration === "object"
      ? line.quick_solution.configuration
      : {};

  const configKey = JSON.stringify(configuration);

  const configurationComplete =
    product &&
    quickSolutionConfigurationComplete(product, configuration);

  const quote = useQuery({
    queryKey: [
      "quickSolutionStaffQuote",
      tenantId,
      productKey,
      configKey,
    ],
    queryFn: () =>
      quoteQuickSolutionStaffItem(
        tenantId,
        productKey,
        configuration
      ),
    enabled: Boolean(
      tenantId &&
      productKey &&
      product &&
      configurationComplete
    ),
    staleTime: 15_000,
    retry: false,
  });

  useEffect(() => {
    if (!product || !quote.data) return;

    const total = Number(quote.data.total || 0);
    if (!Number.isFinite(total)) return;

    const nextQuickSolution = {
      ...(line.quick_solution || {}),
      product_key: product.id,
      commerce_product_id: product.commerceProductId,
      configuration,
      pricing_version: product.pricingVersion,
      pricing_snapshot: quote.data.snapshot || {},
      operations_definition: product.operationsDefinition || {},
    };

    const samePrice = Number(line.price || 0) === total;
    const sameSnapshot =
      JSON.stringify(line.quick_solution?.pricing_snapshot || {}) ===
      JSON.stringify(nextQuickSolution.pricing_snapshot);

    if (samePrice && sameSnapshot) return;

    onPatch({
      name: product.name,
      quantity: 1,
      price: total,
      source: "quick_solution_service",
      category:
        product.customerDefinition?.category ||
        "Quick Solution",
      catalog_item_id: "",
      inventory_item_id: "",
      quick_solution: nextQuickSolution,
    });
  }, [quote.data, productKey]);

  const chooseService = (nextKey) => {
    const selected =
      catalog.find((item) => item.id === nextKey) || null;

    if (!selected) {
      onPatch({
        name: "",
        quantity: 1,
        price: "",
        category: "",
        source: "quick_solution_service",
        quick_solution: {
          product_key: "",
          commerce_product_id: "",
          configuration: {},
          pricing_version: "",
          pricing_snapshot: {},
          operations_definition: {},
        },
      });
      return;
    }

    onPatch({
      name: selected.name,
      quantity: 1,
      price: "",
      category:
        selected.customerDefinition?.category ||
        "Quick Solution",
      source: "quick_solution_service",
      catalog_item_id: "",
      inventory_item_id: "",
      quick_solution: {
        product_key: selected.id,
        commerce_product_id: selected.commerceProductId,
        configuration:
          buildQuickSolutionInitialConfiguration(selected),
        pricing_version: selected.pricingVersion,
        pricing_snapshot: {},
        operations_definition:
          selected.operationsDefinition || {},
      },
    });
  };

  const setConfigurationValue = (fieldId, value) => {
    onPatch({
      quick_solution: {
        ...(line.quick_solution || {}),
        configuration: {
          ...configuration,
          [fieldId]: value,
        },
        pricing_snapshot: {},
      },
      price: "",
    });
  };

  const fields = Array.isArray(
    product?.customerDefinition?.fields
  )
    ? product.customerDefinition.fields
    : [];

  return (
    <div className="rounded-2xl border border-border bg-secondary/20 p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
          <Package className="h-4 w-4 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Service
          </label>

          <select
            value={productKey}
            onChange={(event) =>
              chooseService(event.target.value)
            }
            className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Choose a Quick Solution service…</option>

            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          {product?.description ? (
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
              {product.description}
            </p>
          ) : null}
        </div>

        {allowRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="mt-6 text-muted-foreground transition-colors hover:text-destructive"
            aria-label="Remove service"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {product ? (
        <div className="mt-4 space-y-3">
          {fields.map((field) => {
            if (!field?.id) return null;

            if (field.type === "file") {
              return (
                <div
                  key={field.id}
                  className="rounded-xl border border-dashed border-border bg-background/60 px-3 py-2"
                >
                  <p className="text-xs font-medium text-foreground">
                    {field.label || "Artwork / file"}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    Files can be attached to the order immediately after creation.
                    {field.help ? ` ${field.help}` : ""}
                  </p>
                </div>
              );
            }

            const value =
              configuration[field.id] ??
              field.default ??
              "";

            if (
              field.type === "select" ||
              field.type === "segmented"
            ) {
              const options = fieldOptions(field);

              return (
                <div key={field.id}>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {field.label || field.shortLabel || field.id}
                  </label>

                  {field.type === "segmented" ? (
                    <div className="grid grid-cols-2 gap-2">
                      {options.map((option) => {
                        const selected =
                          String(value) === String(option.id);

                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setConfigurationValue(
                                field.id,
                                option.id
                              )
                            }
                            className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                              selected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-background text-foreground hover:border-primary/40"
                            }`}
                          >
                            <span className="font-semibold">
                              {option.label || option.id}
                            </span>

                            {option.helper ? (
                              <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                                {option.helper}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <select
                      value={value}
                      onChange={(event) =>
                        setConfigurationValue(
                          field.id,
                          event.target.value
                        )
                      }
                      className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      {options.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                        >
                          {option.label || option.id}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            }

            if (field.type === "number") {
              return (
                <div key={field.id}>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {field.label || field.shortLabel || field.id}
                  </label>

                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={field.min}
                      step={field.step}
                      value={value}
                      onChange={(event) =>
                        setConfigurationValue(
                          field.id,
                          event.target.value
                        )
                      }
                      className="h-9 rounded-xl text-sm"
                    />

                    {field.suffix ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {field.suffix}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            }

            return (
              <div key={field.id}>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {field.label || field.shortLabel || field.id}
                </label>

                <Input
                  value={value}
                  onChange={(event) =>
                    setConfigurationValue(
                      field.id,
                      event.target.value
                    )
                  }
                  className="h-9 rounded-xl text-sm"
                />
              </div>
            );
          })}

          <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2.5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Service total
              </p>

              {quote.data?.summary ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {quote.data.summary}
                </p>
              ) : null}
            </div>

            <div className="text-right">
              {quote.isFetching ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Pricing…
                </span>
              ) : quote.isError ? (
                <span className="inline-flex max-w-[180px] items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {quote.error?.message || "Could not calculate price"}
                </span>
              ) : quote.data ? (
                <span className="text-base font-bold text-primary">
                  {money(quote.data.total)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Complete the options
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}