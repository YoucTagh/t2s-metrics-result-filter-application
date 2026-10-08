import { RouterModule } from "@angular/router";
import { AfterViewInit, Component, OnInit, viewChild, ViewChild } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import Yasgui from '@triply/yasgui';
import { DataFactory, Parser, Store } from 'n3';
import { Observable, startWith, map, of } from 'rxjs';
import { ResultsCase } from './models/eval-case';
import { AsyncPipe, KeyValuePipe } from '@angular/common';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

interface MetricFilter {
  metric: string;
  min: number;
  max: number;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatIconModule,
    MatSelectModule,
    FormsModule,
    ReactiveFormsModule,
    AsyncPipe,
    KeyValuePipe
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})


export class App implements OnInit, AfterViewInit {
  caseControl = new FormControl('');
  caseOptions: ResultsCase[] = [];
  filteredCaseOptions!: Observable<ResultsCase[]>;
  selectedCase?: ResultsCase;
  fileName = '';
  resultsFileName = '';
  parseError = '';
  benchmarkControl = new FormControl('');

  availableMetrics: string[] = [];
  loadedCases: ResultsCase[] = [];

  @ViewChild('yasguiOutput') ygOutputContainer: any;
  yasguiOutput?: Yasgui;

  @ViewChild('yasguiExpected') ygExpectedContainer: any;
  yasguiExpected?: Yasgui;

  idCounter = 0;

  metricsControls: FormArray<FormGroup>;

  filteredMetricOptions!: Map<number, Observable<String[]>>;

  constructor(private fb: FormBuilder) {
    this.metricsControls = this.fb.array<FormGroup>([]);
  }


  ngOnInit() {
    this.filteredCaseOptions = this.caseControl.valueChanges.pipe(
      startWith(''),
      map(value => this.filterCases(value || ''))
    );

    this.filteredMetricOptions = new Map<number, Observable<String[]>>();

    this.caseControl.valueChanges.subscribe(caseLabel => {
      if (!caseLabel) {
        return;
      }

      const selected = this.caseOptions.find(option => option.id === caseLabel);
      if (!selected) {
        return;
      }

      this.selectedCase = selected;
      this.setQuery(this.yasguiOutput, selected.generated);
      this.setQuery(this.yasguiExpected, selected.golden);
    });
  }

  ngAfterViewInit() {
    this.yasguiOutput = this.createYasgui(this.ygOutputContainer?.nativeElement);
    this.yasguiExpected = this.createYasgui(this.ygExpectedContainer?.nativeElement);
  }

  applyMetricFilters() {

    const metricFilters: MetricFilter[] = [];

    this.metricsControls.controls.forEach(control => {
      const metric = control.get('metric')?.value;
      const min = control.get('min')?.value;
      const max = control.get('max')?.value;

      if (this.availableMetrics.includes(metric) && typeof min === 'number' && typeof max === 'number') {
        metricFilters.push({ metric, min, max });
      }
      else {
        alert(`Invalid metric filter: ${metric} with min: ${min} and max: ${max}`);
      }
    });

    if (metricFilters.length === 0) {
      return;
    }

    const cases = this.loadedCases.filter(option => {
      for (const filter of metricFilters) {
        const metricValue = (option as any)[filter.metric];
        if (typeof metricValue !== 'number' || metricValue < filter.min || metricValue > filter.max) {
          return false;
        }
      }
      return true;
    });

    this.caseOptions = cases;
    this.filteredCaseOptions = this.caseControl.valueChanges.pipe(
      startWith(''),
      map(value => this.filterCases(value || '')),
      map(options => options.sort((a, b) => a.id.localeCompare(b.id)))
    );
  }

  async loadCasesFromFile(resultString: string) {

    let cases: ResultsCase[] = [];
    try {
      const resultsCases = JSON.parse(resultString) as Record<string, Omit<ResultsCase, 'id'>>;
      cases = Object.entries(resultsCases).map(([id, data]) => this.toResultsCase(data, id));


      for (const cases of Object.values(resultsCases)) {
        for (const metric of Object.keys(cases)) {
          if (!this.availableMetrics.includes(metric) && metric !== 'golden' && metric !== 'generated' && metric !== 'question') {
            this.availableMetrics.push(metric);
          }
        }
      }

      this.availableMetrics.sort((a, b) => a.localeCompare(b));

    } catch (error) {
      this.parseError = `Invalid JSON`;
      console.error('Error parsing JSON file:', error);
    }

    this.caseOptions = cases;

    this.loadedCases = [...cases];
    this.filteredCaseOptions = this.caseControl.valueChanges.pipe(
      startWith(''),
      map(value => this.filterCases(value || '')),
      map(options => options.sort((a, b) => a.id.localeCompare(b.id)))
    );

    this.caseControl.setValue('');
  }
  async onFileSelectedResults(event: Event) {
    this.parseError = '';

    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : undefined;
    if (!file) {
      return;
    }

    this.resultsFileName = file.name;
    const fileContent = await file.text();

    try {
      const store = new Store(new Parser({ format: 'text/turtle' }).parse(fileContent));
      const t2s = 'http://ns.inria.fr/t2s/ontology#';
      const cases: Record<string, Omit<ResultsCase, 'id'>> = {};
      const dataset = store.getQuads(null, null, null, null)
        .find(quad => quad.predicate.value === `${t2s}hasCase`)
        ?.subject;
      const datasetLabel = dataset && store.getQuads(dataset, 'http://www.w3.org/2000/01/rdf-schema#label', null, null)[0]?.object.value;

      let responseIndex = 0;
      for (const responseQuad of store.getQuads(null, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', DataFactory.namedNode(`${t2s}Response`), null)) {
        const responseNode = responseQuad.subject;
        const caseNode = store.getQuads(responseNode, `${t2s}isResponseTo`, null, null)[0]?.object;
        if (!caseNode) {
          continue;
        }

        const caseId = store.getQuads(caseNode, `${t2s}caseID`, null, null)[0]?.object.value;
        if (!caseId) {
          continue;
        }

        const goldQueryNode = store.getQuads(caseNode, `${t2s}hasGoldQuery`, null, null)[0]?.object;
        const generatedQueryNode = store.getQuads(responseNode, `${t2s}hasGeneratedQuery`, null, null)[0]?.object;
        const systemNode = store.getQuads(null, `${t2s}providedResponse`, responseNode, null)[0]?.subject;
        const resultCase: Omit<ResultsCase, 'id'> = {
          golden: goldQueryNode
            ? store.getQuads(goldQueryNode, `${t2s}queryText`, null, null)[0]?.object.value ?? ''
            : '',
          generated: generatedQueryNode
            ? store.getQuads(generatedQueryNode, `${t2s}queryText`, null, null)[0]?.object.value ?? ''
            : '',
          question: store.getQuads(caseNode, `${t2s}question`, null, null)[0]?.object.value ?? null,
          system_name: systemNode
            ? store.getQuads(systemNode, 'http://www.w3.org/2000/01/rdf-schema#label', null, null)[0]?.object.value
            : undefined,
        };

        if (responseNode) {
          for (const annotation of store.getQuads(null, `${t2s}hasTarget`, responseNode, null)) {
            const scoreNode = store.getQuads(annotation.subject, `${t2s}hasBody`, null, null)[0]?.object;
            const metricNode = scoreNode
              ? store.getQuads(scoreNode, `${t2s}forMetric`, null, null)[0]?.object
              : undefined;
            const score = scoreNode
              ? store.getQuads(scoreNode, `${t2s}scoreValue`, null, null)[0]?.object.value
              : undefined;
            const metric = metricNode
              ? store.getQuads(metricNode, 'http://www.w3.org/2000/01/rdf-schema#label', null, null)[0]?.object.value
              : undefined;
            if (metric && score !== undefined) {
              resultCase[metric] = Number(score);
            }
          }
        }

        cases[`${caseId}-${datasetLabel ?? ''}-${responseIndex++}`] = resultCase;
      }

      await this.loadCasesFromFile(JSON.stringify(cases));
    } catch (error) {
      this.parseError = 'Invalid Turtle';
      console.error('Error parsing Turtle file:', error);
    }

    this.benchmarkControl.setValue('');

  }


  private toResultsCase(data: any, id: string): ResultsCase {
    return {
      id: `${id}`,
      ...data
    };
  }


  private filterCases(value: string): ResultsCase[] {
    const filterValue = value.toLowerCase();
    return this.caseOptions.filter(option => option.id.toLowerCase().includes(filterValue));
  }

  private createYasgui(container: HTMLElement | undefined): Yasgui | undefined {
    if (!container) {
      return undefined;
    }

    try {
      return new Yasgui(container, {});
    } catch (error) {
      console.error('Error initializing Yasgui:', error);
      localStorage.removeItem('yagui__config');
      return new Yasgui(container, {});
    }
  }

  private setQuery(yasgui: Yasgui | undefined, query: string) {
    const activeId = yasgui?.persistentConfig.getActiveId();
    yasgui?.getTab(activeId)?.setQuery(query || '');
  }

  get metricsFormArray(): FormArray {
    return this.metricsControls;
  }

  addMetricFilter() {
    const metricGroup = this.fb.group({
      metric: [''],
      min: [0],
      max: [1],
      id: [this.idCounter++]
    });
    this.filteredMetricOptions.set(this.idCounter - 1, of(this.availableMetrics));

    metricGroup.get('metric')?.valueChanges.pipe(
      startWith(''),
      map(value => this.filterMetrics(value || ''))
    ).subscribe(filteredOptions => {
      const id = metricGroup.get('id')?.value;
      if (id != null)
        this.filteredMetricOptions.set(id, of(filteredOptions));

    });

    this.metricsControls.push(metricGroup);
  }

  filterMetrics(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.availableMetrics.filter(option => option.toLowerCase().includes(filterValue));
  }

  removeMetricFilter(index: number) {
    this.metricsControls.removeAt(index);
  }

}