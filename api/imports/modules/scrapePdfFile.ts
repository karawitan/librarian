import { TfIdf, PorterStemmer, AggressiveTokenizer } from 'natural';

import { Publisher } from '/imports/api/publishers';
import { Book, Books } from '/imports/api/books';

import { Logger } from './logger';


// https://www.oreilly.com/library/view/regular-expressions-cookbook/9781449327453/ch04s13.html
const isbnRegExp = new RegExp('^(?:ISBN(?:-1[03])?:?\ )?(?=[0-9X]{10}$|(?=(?:[0-9]+[-\ ]){3})[-\ 0-9X]{13}$|97[89][0-9]{10}$|' +
    '(?=(?:[0-9]+[-\ ]){4})[-\ 0-9]{17}$)(?:97[89][-\ ]?)?[0-9]{1,5}[-\ ]?[0-9]+[-\ ]?[0-9]+[-\ ]?[0-9X]$');


const stopWords = ['a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
    'can\'t', 'cannot', 'could', 'couldn\'t',
    'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
    'each', 'few', 'for', 'from', 'further',
    'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
    'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
    'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s',
    'its', 'itself', 'let\'s',
    'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not',
    'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves',
    'out', 'over', 'own',
    'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such',
    'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these',
    'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very',
    'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s',
    'when', 'when\'s', 'where', 'where\'s', 'will',
    'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
    'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    'one', 'new'];


export class ScrapeFile {

    protected aggressiveTokenizer: AggressiveTokenizer;

    constructor(protected fileInfo: any, protected publishers?: Publisher[]) {
        this.aggressiveTokenizer = new AggressiveTokenizer();
        // @ts-ignore
        PorterStemmer.addStopWords(stopWords);
        PorterStemmer.attach();
    }
}

export class ScrapePDFFile extends ScrapeFile {

    constructor(protected pdfData: any, protected fileInfo: any, protected publishers?: Publisher[]) {
        super(fileInfo, publishers);

    }
    /**
     * Get the most out of the PDF file
     * @param pdfData - from pdf parser
     * @param fileInfo - file data from fs stats
     * @param publishers - list of publishers {title: string, url: string}
     */
    scrapePDFFile() {
        const pdfData = this.pdfData;
        const fileInfo = this.fileInfo;
        const publishers = this.publishers;

        let title = '';
        let description = '';
        let creator = '';
        let authors: string[] = [];

        if (pdfData.metadata && pdfData.metadata._metadata) {
            if (pdfData.metadata._metadata['dc:title']) {
                title = pdfData.metadata._metadata['dc:title'];
            }
            if (pdfData.metadata._metadata['dc:description']) {
                description = pdfData.metadata._metadata['dc:description'];
            }
            if (pdfData.metadata._metadata['dc:creator']) {
                creator = pdfData.metadata._metadata['dc:creator'];
                authors = creator.split(/;/);
            }
        }

        const fileNameTokenized = this.aggressiveTokenizer.tokenize(fileInfo.name);

        // take ISBN
        const isbn = fileNameTokenized.find((word: string, index: number) => {
            if (isbnRegExp.test(word)) {
                fileNameTokenized.splice(index, 1);
                return true;
            }
            return false;
        });

        let publisher: Publisher | undefined;
        if (publishers && publishers.length > 0) {
            let tmpPublisher: Publisher | undefined;
            let publisherWords = 0;
            const publisherIndices: number[] = [];
            fileNameTokenized.find((word: string, index: number) => {
                // search for publisher
                publisher = publishers.find((p: Publisher) => {

                    const tmpPublisherWords = this.aggressiveTokenizer.tokenize(p.title.toLowerCase());

                    if (tmpPublisherWords.includes(word.toLowerCase())) {
                        publisherWords = publisherWords + 1;
                        if (tmpPublisherWords.length !== publisherWords) {
                            // maybe save different words that were found if they from the same publisher GZ?
                            // have to work on aliases like AW
                            tmpPublisher = p;
                            publisherIndices.push(index);
                            return false;
                        }
                        return true;
                    }
                    return false;
                });
                // found or not
                if (publisher) {
                    if (publisherWords === 1) {
                        fileNameTokenized.splice(index, 1);
                    } else {
                        publisherIndices.forEach((v, i) => {
                            fileNameTokenized.splice(v - i, 1);
                        });
                    }
                    return true;
                }
                if (!publisher && publisherWords > 0 && publisherIndices[0] === 0) {
                    publisher = tmpPublisher;
                    fileNameTokenized.splice(0, 1);
                    return true;
                }
                return false;
            });
        }

        if (!title && pdfData.info.Title) {
            title = pdfData.info.Title;
        } else if (title && title.length < pdfData.info.Title.length) {
            title = pdfData.info.Title;
        } else {
            title = fileNameTokenized.join(' ');
        }


        if (!creator && pdfData.info.Author) {
            creator = pdfData.info.Author;
            authors = creator.split(/;/);
        }

        const pdfBook: Book = {} as Book;
        pdfBook.title = title;
        pdfBook.authors = authors;
        pdfBook.isbn = isbn;
        pdfBook.numPages = pdfData.numPages;
        pdfBook.description = description;
        pdfBook.imageBase64 = pdfData.imageBase64;
        pdfBook.publisher = publisher;
        pdfBook.fileInfo = fileInfo;

        const tfIdf = new TfIdf();

        tfIdf.addDocument(pdfData.text);
        let tagsIndex = 0;
        pdfBook.nlpTags = tfIdf.listTerms(0 /*document index*/).filter((item: any) => {
            if (/^([0-9]+|[a-zA-Z]+[0-9]+)[0-9a-zA-Z]*$/.test(item.term) || tagsIndex > 10) {
                return false;
            }
            if (stopWords.includes(item.term)) {
                return false;
            }
            tagsIndex = tagsIndex + 1;
            return true;
        }).map((item: any) => item.term);

        tfIdf.addDocument(pdfData.text.tokenizeAndStem());
        pdfBook.nlpTerms = tfIdf.listTerms(1 /*document index*/).filter((item: any, index: number) => {
            if (/^([0-9]+|[a-zA-Z]+[0-9]+)[0-9a-zA-Z]*$/.test(item.term) || index > 150) {
                return false;
            }
            return true;
        });

        return pdfBook;
    }


    /**
     * Splits file name and
     * @param fileName
     */
    private extractISBN(fileName: string[]): any {

        // take ISBN
        const isbn = fileName.find((word: string, index: number) => {
            if (isbnRegExp.test(word)) {
                fileName.splice(index, 1);
                return true;
            }
            return false;
        });

    }
}